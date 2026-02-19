import type { VaultHandle, VaultSecret } from "./types";
import { randomUUID } from "crypto";
import type { EventBus } from "../events/types";

interface RuntimeIdentity {
  skillId?: string;
  pid?: number;
  createdAt: number;
}

export class Vault {
  private secrets: Map<string, VaultSecret> = new Map();
  private tokens: Map<string, RuntimeIdentity> = new Map();
  // 二进制指纹：token → SHA256 hash
  private fingerprints: Map<string, string> = new Map();
  private eventBus?: EventBus;

  /**
   * 注入 EventBus，启用审计日志
   */
  setEventBus(bus: EventBus) {
    this.eventBus = bus;
  }

  /**
   * 审计日志：通过 EventBus 发布访问事件
   */
  private audit(action: string, details: Record<string, any>) {
    if (this.eventBus) {
      this.eventBus.publish({
        type: "kairo.vault.accessed",
        source: "vault",
        data: { action, ...details, timestamp: Date.now() },
      });
    }
  }

  store(value: string, type: string = "generic"): VaultHandle {
    // 使用加密安全的 UUID
    const id = `vault:${randomUUID()}`;
    const handle: VaultHandle = { id, type };
    const secret: VaultSecret = { value, handle };
    this.secrets.set(id, secret);
    this.audit("store", { handleId: id, type });
    console.log(`[Vault] Stored secret: ${id}`);
    return handle;
  }

  /**
   * @deprecated 直接解析已废弃，请使用 resolveWithToken
   */
  resolve(handleId: string): string | undefined {
    console.warn(`[Vault] Deprecated direct resolve called for ${handleId}`);
    const secret = this.secrets.get(handleId);
    return secret?.value;
  }

  createRuntimeToken(identity: Omit<RuntimeIdentity, 'createdAt'>): string {
    const token = `rt_${randomUUID().replace(/-/g, '')}`;
    this.tokens.set(token, { ...identity, createdAt: Date.now() });
    return token;
  }

  updateTokenIdentity(token: string, updates: Partial<RuntimeIdentity>) {
    const identity = this.tokens.get(token);
    if (identity) {
      this.tokens.set(token, { ...identity, ...updates });
    }
  }

  /**
   * 注册二进制指纹，用于验证调用者身份
   */
  registerFingerprint(token: string, hash: string) {
    this.fingerprints.set(token, hash);
  }

  resolveWithToken(token: string, handleId: string): string | undefined {
    const identity = this.tokens.get(token);
    if (!identity) {
      this.audit("resolve_denied", { reason: "invalid_token", handleId });
      console.warn(`[Vault] Invalid or expired token: ${token}`);
      return undefined;
    }

    const secret = this.secrets.get(handleId);
    if (!secret) {
      this.audit("resolve_denied", { reason: "handle_not_found", handleId, skillId: identity.skillId });
      console.warn(`[Vault] Secret not found: ${handleId}`);
      return undefined;
    }

    this.audit("resolve_success", { handleId, skillId: identity.skillId, pid: identity.pid });
    console.log(`[Vault] Secret accessed by ${identity.skillId} (PID: ${identity.pid})`);
    return secret.value;
  }

  /**
   * 凭证轮换：更新密钥值并发布轮换事件
   */
  rotate(handleId: string, newValue: string): boolean {
    const secret = this.secrets.get(handleId);
    if (!secret) return false;

    secret.value = newValue;

    if (this.eventBus) {
      this.eventBus.publish({
        type: "kairo.vault.rotated",
        source: "vault",
        data: { handleId, type: secret.handle.type, rotatedAt: Date.now() },
      });
    }

    this.audit("rotated", { handleId });
    return true;
  }

  revokeToken(token: string) {
    this.tokens.delete(token);
    this.fingerprints.delete(token);
    this.audit("token_revoked", { token: token.slice(0, 8) + "..." });
  }
}
