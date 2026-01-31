import { describe, it, expect, mock } from "bun:test";
import { InMemoryGlobalBus } from "./in-memory-bus";
import { RingBufferEventStore } from "./event-store";
import type { KairoEvent } from "./types";

function createBus() {
  const store = new RingBufferEventStore();
  const bus = new InMemoryGlobalBus(store);
  return { bus, store };
}

describe("Global Event Bus", () => {
  it("should publish and subscribe to exact topics", async () => {
    const { bus } = createBus();
    const handler = mock(() => {});
    
    bus.subscribe("test.topic", handler);
    await bus.publish({ type: "test.topic", source: "test", data: { foo: "bar" } });
    
    expect(handler).toHaveBeenCalled();
    const calls = handler.mock.calls as unknown as any[][];
    const event = calls[0]![0] as KairoEvent;
    expect(event.type).toBe("test.topic");
    expect(event.data).toEqual({ foo: "bar" });
  });

  it("should handle wildcard subscriptions (*)", async () => {
    const { bus } = createBus();
    const handler = mock(() => {});
    
    bus.subscribe("test.*.event", handler);
    
    await bus.publish({ type: "test.foo.event", source: "test", data: 1 });
    await bus.publish({ type: "test.bar.event", source: "test", data: 2 });
    await bus.publish({ type: "test.foo.other", source: "test", data: 3 }); // Should not match
    
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should handle wildcard subscriptions (>)", async () => {
    const { bus } = createBus();
    const handler = mock(() => {});
    
    bus.subscribe("test.>", handler);
    
    await bus.publish({ type: "test.foo", source: "test", data: 1 });
    await bus.publish({ type: "test.foo.bar", source: "test", data: 2 });
    await bus.publish({ type: "other.foo", source: "test", data: 3 }); // Should not match
    
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should persist events to store", async () => {
    const { bus, store } = createBus();
    
    await bus.publish({ type: "test.1", source: "test", data: 1 });
    await bus.publish({ type: "test.2", source: "test", data: 2 });
    
    // Allow async persistence to complete
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const events = await store.query({});
    expect(events.length).toBe(2);
    expect(events[0]!.type).toBe("test.1");
    expect(events[1]!.type).toBe("test.2");
  });

  it("should support request/response pattern", async () => {
    const { bus } = createBus();
    
    // Simulate a service responding to requests
    bus.subscribe("service.request", async (event: KairoEvent) => {
      const { correlationId } = event;
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      bus.publish({
        type: "service.response",
        source: "service",
        data: { result: "ok" },
        correlationId
      });
    });
    
    const result = await bus.request("service.request", { query: "foo" });
    expect(result).toEqual({ result: "ok" });
  });

  it("should timeout request if no response", async () => {
    const { bus } = createBus();
    
    // No listener
    
    try {
      await bus.request("service.timeout", {}, 100);
      throw new Error("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("timeout");
    }
  });
});
