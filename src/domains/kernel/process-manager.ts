import { spawn, type Subprocess } from 'bun';
import { SandboxManager } from '../sandbox/sandbox-manager';
import { quote } from 'shell-quote';

export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  limits?: {
    cpu?: number;
    memory?: number;
  };
}

export class ProcessManager {
  private processes = new Map<string, Subprocess>();
  private pidMap = new Map<string, number>();

  async spawn(id: string, command: string[], options: ProcessOptions = {}): Promise<void> {
    let finalCommand = command;
    let shellMode = false;

    // Apply Sandbox / Limits
    // If limits are present OR if we want to enforce sandbox (we can check if sandbox is configured)
    // For now, we prioritize limits as requested.
    if (options.limits) {
       const cmdString = quote(command);
       
       const resourceLimits = {
           memory: options.limits.memory,
           cpu: options.limits.cpu
       };

       const wrapped = await SandboxManager.wrapWithSandbox(cmdString, undefined, resourceLimits);
       
       // wrapWithSandbox returns the command string unchanged if no sandbox/limits needed
       if (wrapped !== cmdString) {
           finalCommand = ['/bin/sh', '-c', wrapped];
           shellMode = true;
       }
    }

    const proc = spawn(finalCommand, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
    });

    this.processes.set(id, proc);
    this.pidMap.set(id, proc.pid);
    
    console.log(`[ProcessManager] Spawned process ${id} (PID: ${proc.pid})`);
  }

  kill(id: string): void {
    const proc = this.processes.get(id);
    if (proc) {
      proc.kill();
      this.processes.delete(id);
      this.pidMap.delete(id);
      console.log(`[ProcessManager] Killed process ${id}`);
    }
  }

  pause(id: string): boolean {
    const pid = this.pidMap.get(id);
    if (pid) {
      try {
        process.kill(pid, 'SIGSTOP');
        console.log(`[ProcessManager] Paused process ${id} (PID: ${pid})`);
        return true;
      } catch (e) {
        console.error(`[ProcessManager] Failed to pause process ${id}:`, e);
      }
    }
    return false;
  }

  resume(id: string): boolean {
    const pid = this.pidMap.get(id);
    if (pid) {
      try {
        process.kill(pid, 'SIGCONT');
        console.log(`[ProcessManager] Resumed process ${id} (PID: ${pid})`);
        return true;
      } catch (e) {
        console.error(`[ProcessManager] Failed to resume process ${id}:`, e);
      }
    }
    return false;
  }

  getProcess(id: string): Subprocess | undefined {
    return this.processes.get(id);
  }
}
