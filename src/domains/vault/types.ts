export interface VaultHandle {
  id: string;
  type: string;
  metadata?: Record<string, any>;
  expiresAt?: number;
}

export interface VaultSecret {
  value: string;
  handle: VaultHandle;
}
