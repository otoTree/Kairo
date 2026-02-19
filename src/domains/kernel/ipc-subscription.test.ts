import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { IPCServer } from "./ipc-server";
import { IPCClient } from "./ipc-client";
import { ProcessManager } from "./process-manager";
import { SystemMonitor } from "./system-info";
import { DeviceRegistry } from "../device/registry";
import { InMemoryGlobalBus } from "../events/in-memory-bus";
import { RingBufferEventStore } from "../events/event-store";

const SOCKET_PATH = `/tmp/kairo-test-sub-${process.pid}.sock`;

/**
 * IPC 事件订阅集成测试
 * 验证外部进程通过 IPC 订阅 EventBus 事件
 */
describe("IPC 事件订阅", () => {
  let server: IPCServer;
  let bus: InMemoryGlobalBus;

  beforeEach(async () => {
    const processManager = new ProcessManager();
    const systemMonitor = new SystemMonitor();
    const deviceRegistry = new DeviceRegistry();
    const store = new RingBufferEventStore();
    bus = new InMemoryGlobalBus(store);

    server = new IPCServer(
      processManager, systemMonitor, deviceRegistry,
      undefined, SOCKET_PATH
    );
    server.setEventBus(bus);
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it("客户端订阅 topic 后能收到匹配的事件", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    // 订阅 topic
    const subResult = await client.request("subscribe", { topic: "kairo.test.hello" });
    expect(subResult.subscriptionId).toBeDefined();

    // 收集推送的事件
    const receivedEvents: any[] = [];
    client.on("event", (payload: any) => {
      receivedEvents.push(payload);
    });

    // 通过 EventBus 发布事件
    await bus.publish({
      type: "kairo.test.hello",
      source: "test",
      data: { message: "world" },
    });

    // 等待事件推送
    await new Promise(r => setTimeout(r, 100));

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    const evt = receivedEvents.find(e => e.topic === "kairo.test.hello");
    expect(evt).toBeDefined();
    expect(evt.payload).toEqual({ message: "world" });
    expect(evt.correlationId).toBeDefined();

    client.close();
  });

  it("通配符订阅能匹配多个 topic", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    // 使用通配符订阅
    await client.request("subscribe", { topic: "kairo.test.*" });

    const receivedEvents: any[] = [];
    client.on("event", (payload: any) => {
      receivedEvents.push(payload);
    });

    // 发布多个匹配的事件
    await bus.publish({ type: "kairo.test.alpha", source: "test", data: { v: 1 } });
    await bus.publish({ type: "kairo.test.beta", source: "test", data: { v: 2 } });
    // 不匹配的事件
    await bus.publish({ type: "kairo.other.gamma", source: "test", data: { v: 3 } });

    await new Promise(r => setTimeout(r, 100));

    const matched = receivedEvents.filter(
      e => e.topic === "kairo.test.alpha" || e.topic === "kairo.test.beta"
    );
    expect(matched.length).toBe(2);

    // 不应收到不匹配的事件
    const unmatched = receivedEvents.filter(e => e.topic === "kairo.other.gamma");
    expect(unmatched.length).toBe(0);

    client.close();
  });

  it("取消订阅后不再收到事件", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    const subResult = await client.request("subscribe", { topic: "kairo.unsub.test" });
    const subId = subResult.subscriptionId;

    const receivedEvents: any[] = [];
    client.on("event", (payload: any) => {
      receivedEvents.push(payload);
    });

    // 发布一个事件 — 应该收到
    await bus.publish({ type: "kairo.unsub.test", source: "test", data: { phase: "before" } });
    await new Promise(r => setTimeout(r, 100));
    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);

    const countBefore = receivedEvents.length;

    // 取消订阅
    const unsubResult = await client.request("unsubscribe", { subscriptionId: subId });
    expect(unsubResult.ok).toBe(true);

    // 再发布一个事件 — 不应该收到
    await bus.publish({ type: "kairo.unsub.test", source: "test", data: { phase: "after" } });
    await new Promise(r => setTimeout(r, 100));

    expect(receivedEvents.length).toBe(countBefore);

    client.close();
  });

  it("事件推送携带 correlationId 和 source", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    await client.request("subscribe", { topic: "kairo.trace.test" });

    const receivedEvents: any[] = [];
    client.on("event", (payload: any) => {
      receivedEvents.push(payload);
    });

    await bus.publish({
      type: "kairo.trace.test",
      source: "agent:default",
      data: { action: "think" },
      correlationId: "trace-abc",
      causationId: "cause-xyz",
    });

    await new Promise(r => setTimeout(r, 100));

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    const evt = receivedEvents.find(e => e.topic === "kairo.trace.test");
    expect(evt.correlationId).toBe("trace-abc");
    expect(evt.causationId).toBe("cause-xyz");
    expect(evt.source).toBe("agent:default");

    client.close();
  });
});
