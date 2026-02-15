import { ProcessManager } from '../kernel/process-manager';
import type { SandboxRuntimeConfig } from '../sandbox/sandbox-config';
import type { Vault } from '../vault/vault';

export class BinaryRunner {
  private vault?: Vault;

  constructor(private processManager: ProcessManager) {}

  setVault(vault: Vault) {
    this.vault = vault;
  }

  /**
   * 启动二进制技能
   * @param skillName 技能名称
   * @param binaryPath 二进制文件绝对路径
   * @param args 启动参数
   * @param env 环境变量
   * @param context 追踪上下文
   * @param sandboxConfig 沙箱配置
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
    if (this.vault) {
        runtimeToken = this.vault.createRuntimeToken({
            skillId: skillName,
            // pid is not known yet
        });
    }

    console.log(`[BinaryRunner] Starting ${skillName} from ${binaryPath}`);
    
    await this.processManager.spawn(id, [binaryPath, ...args], {
      env: {
        ...env, // Do not resolve vault: handles to plaintext
        KAIRO_SKILL_NAME: skillName,
        KAIRO_RUNTIME_TOKEN: runtimeToken,
        KAIRO_IPC_SOCKET: env.KAIRO_IPC_SOCKET || '/tmp/kairo-kernel.sock',
        ...(context?.correlationId ? { KAIRO_CORRELATION_ID: context.correlationId } : {}),
        ...(context?.causationId ? { KAIRO_CAUSATION_ID: context.causationId } : {}),
      },
      sandbox: sandboxConfig
    });

    // If we want to bind PID to token, we need to do it here
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
