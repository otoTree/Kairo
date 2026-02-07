import { ProcessManager } from '../kernel/process-manager';

export class BinaryRunner {
  constructor(private processManager: ProcessManager) {}

  /**
   * 启动二进制技能
   * @param skillName 技能名称
   * @param binaryPath 二进制文件绝对路径
   * @param args 启动参数
   * @param env 环境变量
   */
  async run(skillName: string, binaryPath: string, args: string[] = [], env: Record<string, string> = {}) {
    const id = `skill-${skillName}-${Date.now()}`;
    
    console.log(`[BinaryRunner] Starting ${skillName} from ${binaryPath}`);
    
    await this.processManager.spawn(id, [binaryPath, ...args], {
      env: {
        ...env,
        KAIRO_SKILL_NAME: skillName,
        KAIRO_IPC_SOCKET: '/tmp/kairo-kernel.sock', // Inject default IPC path
      }
    });

    return id;
  }

  stop(id: string) {
    this.processManager.kill(id);
  }
}
