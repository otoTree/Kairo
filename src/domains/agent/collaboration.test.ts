import { describe, it, expect } from "bun:test";
import { CapabilityRegistry, type AgentCapability } from "./capability-registry";
import { InMemorySharedMemory } from "./shared-memory";

/**
 * Agent 协作模型测试
 * 验证能力注册表和 SharedMemory 命名空间
 */
describe("CapabilityRegistry", () => {
  it("注册和查询能力", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      agentId: "agent-a",
      name: "code_review",
      description: "代码审查和质量分析",
      registeredAt: Date.now(),
    });

    const caps = registry.getCapabilities("agent-a");
    expect(caps).toHaveLength(1);
    expect(caps[0].name).toBe("code_review");
  });

  it("避免重复注册同名能力", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      agentId: "agent-a",
      name: "code_review",
      description: "v1",
      registeredAt: Date.now(),
    });
    registry.register({
      agentId: "agent-a",
      name: "code_review",
      description: "v2",
      registeredAt: Date.now(),
    });

    const caps = registry.getCapabilities("agent-a");
    expect(caps).toHaveLength(1);
    expect(caps[0].description).toBe("v2");
  });

  it("findBestAgent 根据任务描述匹配", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      agentId: "agent-a",
      name: "file_processing",
      description: "文件处理和格式转换",
      registeredAt: Date.now(),
    });
    registry.register({
      agentId: "agent-b",
      name: "code_review",
      description: "代码审查和质量分析",
      registeredAt: Date.now(),
    });

    const match = registry.findBestAgent("请帮我做 code_review");
    expect(match).toBeDefined();
    expect(match!.agentId).toBe("agent-b");
  });

  it("unregister 移除 Agent 的所有能力", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      agentId: "agent-a",
      name: "cap1",
      description: "d1",
      registeredAt: Date.now(),
    });
    registry.register({
      agentId: "agent-a",
      name: "cap2",
      description: "d2",
      registeredAt: Date.now(),
    });

    registry.unregister("agent-a");
    expect(registry.getCapabilities("agent-a")).toHaveLength(0);
    expect(registry.getAllCapabilities()).toHaveLength(0);
  });

  it("getAllCapabilities 返回所有 Agent 的能力", () => {
    const registry = new CapabilityRegistry();
    registry.register({ agentId: "a", name: "c1", description: "d1", registeredAt: Date.now() });
    registry.register({ agentId: "b", name: "c2", description: "d2", registeredAt: Date.now() });

    const all = registry.getAllCapabilities();
    expect(all).toHaveLength(2);
  });
});

describe("SharedMemory 命名空间", () => {
  it("不同命名空间的 facts 隔离", async () => {
    const sm = new InMemorySharedMemory();
    await sm.addFact("fact-a", "ns-a");
    await sm.addFact("fact-b", "ns-b");

    const factsA = await sm.getFacts(undefined, "ns-a");
    const factsB = await sm.getFacts(undefined, "ns-b");

    expect(factsA).toContain("fact-a");
    expect(factsA).not.toContain("fact-b");
    expect(factsB).toContain("fact-b");
    expect(factsB).not.toContain("fact-a");
  });

  it("global 命名空间的 facts 对所有命名空间可见", async () => {
    const sm = new InMemorySharedMemory();
    await sm.addFact("global-fact", "global");
    await sm.addFact("ns-fact", "ns-a");

    const factsA = await sm.getFacts(undefined, "ns-a");
    expect(factsA).toContain("global-fact");
    expect(factsA).toContain("ns-fact");
  });

  it("默认命名空间为 global", async () => {
    const sm = new InMemorySharedMemory();
    await sm.addFact("default-fact");

    const facts = await sm.getFacts();
    expect(facts).toContain("default-fact");

    // 其他命名空间也能看到 global facts
    const nsAFacts = await sm.getFacts(undefined, "ns-a");
    expect(nsAFacts).toContain("default-fact");
  });

  it("query 过滤在命名空间内生效", async () => {
    const sm = new InMemorySharedMemory();
    await sm.addFact("apple pie recipe", "cooking");
    await sm.addFact("banana smoothie", "cooking");
    await sm.addFact("apple stock price", "finance");

    const results = await sm.getFacts("apple", "cooking");
    expect(results).toContain("apple pie recipe");
    expect(results).not.toContain("banana smoothie");
    expect(results).not.toContain("apple stock price");
  });
});
