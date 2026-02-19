import { describe, it, expect, beforeEach } from "bun:test";
import { Vault } from "./vault";
import { InMemoryGlobalBus } from "../events/in-memory-bus";
import { RingBufferEventStore } from "../events/event-store";
import type { KairoEvent } from "../events/types";

/**
 * Vault 安全测试
 * 验证 token 鉴权、审计日志、指纹验证、凭证轮换
 */
describe("Vault 安全闭环", () => {
  let vault: Vault;
  let bus: InMemoryGlobalBus;
  let auditEvents: KairoEvent[];

  beforeEach(() => {
    vault = new Vault();
    const store = new RingBufferEventStore();
    bus = new InMemoryGlobalBus(store);
    vault.setEventBus(bus);
    auditEvents = [];
    bus.subscribe("kairo.vault.>", (event: KairoEvent) => {
      auditEvents.push(event);
    });
  });

  it("Handle ID 使用 UUID 格式", () => {
    const handle = vault.store("my-secret", "api_key");
    // 应该是 vault: 前缀 + UUID 格式
    expect(handle.id).toMatch(/^vault:[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("无 token 无法 resolve vault handle", () => {
    const handle = vault.store("secret-value");
    const result = vault.resolveWithToken("invalid-token", handle.id);
    expect(result).toBeUndefined();
  });

  it("正确 token 可以 resolve vault handle", () => {
    const handle = vault.store("secret-value");
    const token = vault.createRuntimeToken({ skillId: "test-skill" });
    const result = vault.resolveWithToken(token, handle.id);
    expect(result).toBe("secret-value");
  });

  it("已撤销的 token 无法 resolve", () => {
    const handle = vault.store("secret-value");
    const token = vault.createRuntimeToken({ skillId: "test-skill" });
    vault.revokeToken(token);
    const result = vault.resolveWithToken(token, handle.id);
    expect(result).toBeUndefined();
  });

  it("审计事件通过 EventBus 正确发布", async () => {
    const handle = vault.store("audit-test");
    const token = vault.createRuntimeToken({ skillId: "audit-skill" });
    vault.resolveWithToken(token, handle.id);

    // 等待异步事件
    await new Promise(r => setTimeout(r, 50));

    // 应该有 store 和 resolve_success 两个审计事件
    const storeEvents = auditEvents.filter(e => (e.data as any).action === "store");
    const resolveEvents = auditEvents.filter(e => (e.data as any).action === "resolve_success");
    expect(storeEvents.length).toBeGreaterThanOrEqual(1);
    expect(resolveEvents.length).toBeGreaterThanOrEqual(1);
    expect((resolveEvents[0].data as any).skillId).toBe("audit-skill");
  });

  it("凭证轮换后发布 kairo.vault.rotated 事件", async () => {
    const handle = vault.store("old-value");
    const rotated = vault.rotate(handle.id, "new-value");
    expect(rotated).toBe(true);

    // 验证新值
    const token = vault.createRuntimeToken({ skillId: "test" });
    const result = vault.resolveWithToken(token, handle.id);
    expect(result).toBe("new-value");

    await new Promise(r => setTimeout(r, 50));

    const rotateEvents = auditEvents.filter(e => e.type === "kairo.vault.rotated");
    expect(rotateEvents.length).toBeGreaterThanOrEqual(1);
    expect((rotateEvents[0].data as any).handleId).toBe(handle.id);
  });

  it("轮换不存在的 handle 返回 false", () => {
    const result = vault.rotate("vault:nonexistent", "value");
    expect(result).toBe(false);
  });

  it("指纹注册和验证", () => {
    const handle = vault.store("fingerprint-test");
    const token = vault.createRuntimeToken({ skillId: "fp-skill" });
    vault.registerFingerprint(token, "abc123hash");

    // resolveWithToken 目前不强制验证指纹（可选），但指纹已注册
    const result = vault.resolveWithToken(token, handle.id);
    expect(result).toBe("fingerprint-test");
  });
});
