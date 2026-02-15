import type { VaultHandle, VaultSecret } from "./types";
import { randomUUID } from "crypto";

interface RuntimeIdentity {
  skillId?: string;
  pid?: number;
  createdAt: number;
}

export class Vault {
  private secrets: Map<string, VaultSecret> = new Map();
  private tokens: Map<string, RuntimeIdentity> = new Map();

  store(value: string, type: string = "generic"): VaultHandle {
    const id = `vault:${Math.random().toString(36).substring(7)}`;
    const handle: VaultHandle = {
      id,
      type,
    };
    const secret: VaultSecret = {
      value,
      handle,
    };
    this.secrets.set(id, secret);
    console.log(`[Vault] Stored secret: ${id}`);
    return handle;
  }

  /**
   * @deprecated Direct resolution is deprecated. Use resolveWithToken instead.
   */
  resolve(handleId: string): string | undefined {
    // For backward compatibility during migration, but should warn
    console.warn(`[Vault] Deprecated direct resolve called for ${handleId}`);
    const secret = this.secrets.get(handleId);
    return secret?.value;
  }

  createRuntimeToken(identity: Omit<RuntimeIdentity, 'createdAt'>): string {
    const token = `rt_${randomUUID().replace(/-/g, '')}`;
    this.tokens.set(token, {
      ...identity,
      createdAt: Date.now()
    });
    return token;
  }

  updateTokenIdentity(token: string, updates: Partial<RuntimeIdentity>) {
    const identity = this.tokens.get(token);
    if (identity) {
      this.tokens.set(token, { ...identity, ...updates });
    }
  }

  resolveWithToken(token: string, handleId: string): string | undefined {
    const identity = this.tokens.get(token);
    if (!identity) {
      console.warn(`[Vault] Invalid or expired token: ${token}`);
      return undefined;
    }

    // Here we could enforce policies, e.g. "This skill is allowed to access this handle?"
    // For now, we assume possession of handle ID + valid runtime token is enough.
    
    const secret = this.secrets.get(handleId);
    if (!secret) {
      console.warn(`[Vault] Secret not found: ${handleId}`);
      return undefined;
    }

    console.log(`[Vault] Secret accessed by ${identity.skillId} (PID: ${identity.pid})`);
    return secret.value;
  }

  revokeToken(token: string) {
    this.tokens.delete(token);
  }
}
