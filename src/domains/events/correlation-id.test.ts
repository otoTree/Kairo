import { describe, it, expect, mock } from "bun:test";
import { InMemoryGlobalBus } from "./in-memory-bus";
import { RingBufferEventStore } from "./event-store";
import type { KairoEvent } from "./types";

function createBus() {
  const store = new RingBufferEventStore();
  const bus = new InMemoryGlobalBus(store);
  return { bus, store };
}

describe("correlationId 传播语义", () => {
  it("未提供 correlationId 时，自动填充为事件自身 ID", async () => {
    const { bus } = createBus();
    let captured: KairoEvent | null = null;

    bus.subscribe("test.event", (event: KairoEvent) => {
      captured = event;
    });

    await bus.publish({ type: "test.event", source: "test", data: {} });

    expect(captured).not.toBeNull();
    expect(captured!.correlationId).toBeDefined();
    // correlationId 应等于事件自身 ID
    expect(captured!.correlationId).toBe(captured!.id);
  });

  it("已提供 correlationId 时，保持不变", async () => {
    const { bus } = createBus();
    let captured: KairoEvent | null = null;
    const customCorrelationId = "custom-correlation-123";

    bus.subscribe("test.event", (event: KairoEvent) => {
      captured = event;
    });

    await bus.publish({
      type: "test.event",
      source: "test",
      data: {},
      correlationId: customCorrelationId,
    });

    expect(captured).not.toBeNull();
    expect(captured!.correlationId).toBe(customCorrelationId);
  });

  it("事件链中 correlationId 保持一致", async () => {
    const { bus } = createBus();
    const events: KairoEvent[] = [];

    bus.subscribe("step.>", (event: KairoEvent) => {
      events.push(event);
    });

    // 第一个事件：链的起点
    const firstId = await bus.publish({
      type: "step.one",
      source: "test",
      data: { step: 1 },
    });

    // 第二个事件：引用第一个事件的 correlationId
    await bus.publish({
      type: "step.two",
      source: "test",
      data: { step: 2 },
      correlationId: firstId,
      causationId: firstId,
    });

    // 第三个事件：继续引用同一个 correlationId
    const secondEvent = events[1]!;
    await bus.publish({
      type: "step.three",
      source: "test",
      data: { step: 3 },
      correlationId: firstId,
      causationId: secondEvent.id,
    });

    expect(events).toHaveLength(3);
    // 第一个事件的 correlationId 等于自身 ID
    expect(events[0]!.correlationId).toBe(events[0]!.id);
    // 后续事件的 correlationId 都等于第一个事件的 ID
    expect(events[1]!.correlationId).toBe(firstId);
    expect(events[2]!.correlationId).toBe(firstId);
    // causationId 形成因果链
    expect(events[1]!.causationId).toBe(firstId);
    expect(events[2]!.causationId).toBe(secondEvent.id);
  });

  it("publish 返回的 ID 与事件 ID 一致", async () => {
    const { bus } = createBus();
    let captured: KairoEvent | null = null;

    bus.subscribe("test.id", (event: KairoEvent) => {
      captured = event;
    });

    const returnedId = await bus.publish({
      type: "test.id",
      source: "test",
      data: {},
    });

    expect(captured).not.toBeNull();
    expect(returnedId).toBe(captured!.id);
  });

  it("每个事件的 ID 唯一", async () => {
    const { bus } = createBus();
    const ids = new Set<string>();

    bus.subscribe("test.unique", (event: KairoEvent) => {
      ids.add(event.id);
    });

    for (let i = 0; i < 100; i++) {
      await bus.publish({ type: "test.unique", source: "test", data: { i } });
    }

    expect(ids.size).toBe(100);
  });

  it("request/response 模式中 correlationId 正确传播", async () => {
    const { bus } = createBus();
    let requestCorrelationId: string | undefined;

    bus.subscribe("service.ping", async (event: KairoEvent) => {
      requestCorrelationId = event.correlationId;
      await bus.publish({
        type: "service.pong",
        source: "service",
        data: { pong: true },
        correlationId: event.correlationId,
        causationId: event.id,
      });
    });

    const result = await bus.request("service.ping", { ping: true });
    expect(result).toEqual({ pong: true });
    expect(requestCorrelationId).toBeDefined();
  });
});
