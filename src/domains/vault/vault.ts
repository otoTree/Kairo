import type { VaultHandle, VaultSecret } from "./types";

export class Vault {
  private secrets: Map<string, VaultSecret> = new Map();

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

  resolve(handleId: string): string | undefined {
    const secret = this.secrets.get(handleId);
    return secret?.value;
  }
}
