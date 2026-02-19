import { ProcessManager } from '../kernel/process-manager';
import type { SandboxRuntimeConfig } from '../sandbox/sandbox-config';
import type { Vault } from '../vault/vault';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

export class BinaryRunner {
  private vault?: Vault;

  constructor(private processManager: ProcessManager) {}

  setVault(vault: Vault) {
    this.vault = vault;
  }

  /**
   * 启动二进制技能
   */
  async run(
    skillName: string,
    binaryPath: string,
    args: string[] = [],
    env: Record<string, string> = {},
    context?: { correlationId?: string, causationId?: string },
    sandboxConfig?: SandboxRuntimeConfig
  ) {
    const id = `skill-${skillName}-${Date.now()}`;

    let runtimeToken = "";
    let binaryHash = "";

    // 计算二进制 SHA256 指纹
    try {
      const binaryContent = await readFile(binaryPath);
      binaryHash = createHash('sha256').update(binaryContent).digest('hex');
    } catch (e) {
      console.warn(`[BinaryRunner] 无法计算二进制指纹: ${binaryPath}`, e);
    }

    if (this.vault) {
        runtimeToken = this.vault.createRuntimeToken({
            skillId: skillName,
        });
        // 将指纹绑定到 token
        if (binaryHash) {
            this.vault.registerFingerprint(runtimeToken, binaryHash);
        }
    }

    console.log(`[BinaryRunner] Starting ${skillName} from ${binaryPath}`);

    await this.processManager.spawn(id, [binaryPath, ...args], {
      env: {
        ...env,
        KAIRO_SKILL_NAME: skillName,
        KAIRO_RUNTIME_TOKEN: runtimeToken,
        KAIRO_BINARY_HASH: binaryHash,
        KAIRO_IPC_SOCKET: env.KAIRO_IPC_SOCKET || '/tmp/kairo-kernel.sock',
        ...(context?.correlationId ? { KAIRO_CORRELATION_ID: context.correlationId } : {}),
        ...(context?.causationId ? { KAIRO_CAUSATION_ID: context.causationId } : {}),
      },
      sandbox: sandboxConfig
    });

    // 绑定 PID 到 token
    const proc = this.processManager.getProcess(id);
    if (proc && this.vault && runtimeToken) {
        this.vault.updateTokenIdentity(runtimeToken, { pid: proc.pid });
    }

    return id;
  }

  stop(id: string) {
    this.processManager.kill(id);
  }
}
