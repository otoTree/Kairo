import { spawn, type Subprocess, type FileSink } from 'bun';
import { SandboxManager } from '../sandbox/sandbox-manager';
import { quote } from 'shell-quote';
import { EventEmitter } from 'node:events';
import type { StateRepository } from '../database/repositories/state-repository';

import type { SandboxRuntimeConfig } from '../sandbox/sandbox-config';

export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  limits?: {
    cpu?: number;
    memory?: number;
  };
  sandbox?: SandboxRuntimeConfig;
}

export interface ProcessState {
  id: string;
  pid: number;
  command: string[];
  options: ProcessOptions;
  startTime: number;
  endTime?: number;
  status: 'running' | 'exited' | 'abnormal_exit';
  exitCode?: number;
}

export class ProcessManager extends EventEmitter {
  private processes = new Map<string, Subprocess>();
  private pidMap = new Map<string, number>();
  // 进程所有权追踪：processId → creatorId
  private creatorMap = new Map<string, string>();
  // 已退出进程的退出码缓存
  private exitCodes = new Map<string, number>();

  constructor(private stateRepo?: StateRepository) {
    super();
  }

  async recover() {
    if (!this.stateRepo) return;
    const processes = await this.stateRepo.getByPrefix<ProcessState>('process:');
    
    for (const { value: state } of processes) {
      if (state.status === 'running') {
        try {
          // Check if process exists (signal 0)
          process.kill(state.pid, 0);
          
          console.log(`[ProcessManager] Recovered process ${state.id} (PID: ${state.pid}) - Still Running`);
          // Mark as running but we can't control it fully without Subprocess handle
          // For now, we just acknowledge it exists.
          this.pidMap.set(state.id, state.pid);
          
        } catch (e) {
          console.log(`[ProcessManager] Process ${state.id} (PID: ${state.pid}) is gone. Marking abnormal_exit.`);
          state.status = 'abnormal_exit';
          state.endTime = Date.now();
          await this.stateRepo.save(`process:${state.id}`, state);
          // Emit exit event? Maybe not, since it happened while we were down.
        }
      }
    }
  }

  async spawn(id: string, command: string[], options: ProcessOptions = {}, creatorId?: string): Promise<void> {
    let finalCommand = command;
    let shellMode = false;

    // Apply Sandbox / Limits
    if (options.limits || options.sandbox) {
       const cmdString = quote(command);
       
       const resourceLimits = options.limits ? {
           memory: options.limits.memory,
           cpu: options.limits.cpu
       } : undefined;

       const wrapped = await SandboxManager.wrapWithSandbox(cmdString, options.sandbox, resourceLimits);
       
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
    if (creatorId) {
      this.creatorMap.set(id, creatorId);
    }
    
    console.log(`[ProcessManager] Spawned process ${id} (PID: ${proc.pid})`);

    if (this.stateRepo) {
      const state: ProcessState = {
        id,
        pid: proc.pid,
        command,
        options,
        startTime: Date.now(),
        status: 'running'
      };
      await this.stateRepo.save(`process:${id}`, state).catch((e: unknown) => console.error(`[ProcessManager] Failed to save state for ${id}:`, e));
    }

    // Handle stdout
    if (proc.stdout) {
      this.streamToEvent(id, 'stdout', proc.stdout);
    }

    // Handle stderr
    if (proc.stderr) {
      this.streamToEvent(id, 'stderr', proc.stderr);
    }

    // Handle exit
    proc.exited.then(async (code) => {
        if (this.stateRepo) {
          try {
            const state = await this.stateRepo.get<ProcessState>(`process:${id}`);
            if (state) {
              state.status = 'exited';
              state.exitCode = code;
              state.endTime = Date.now();
              await this.stateRepo.save(`process:${id}`, state);
            }
          } catch (e) {
            console.error(`[ProcessManager] Failed to update state for ${id}:`, e);
          }
        }

        this.emit('exit', { id, code });
        this.exitCodes.set(id, code);
        this.cleanup(id);
    });
  }

  private async streamToEvent(id: string, type: 'stdout' | 'stderr', stream: ReadableStream) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.emit('output', { id, type, data: value });
      }
    } catch (error) {
      console.error(`[ProcessManager] Error reading ${type} for process ${id}:`, error);
    }
  }

  writeToStdin(id: string, data: string | Buffer | Uint8Array): void {
    const proc = this.processes.get(id);
    if (proc && proc.stdin && typeof proc.stdin === 'object') {
      const stdin = proc.stdin as FileSink;
      // Bun's FileSink interface: write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number
      stdin.write(data);
      stdin.flush();
    } else {
      throw new Error(`Process ${id} not found or stdin not available`);
    }
  }

  async wait(id: string): Promise<number> {
    const proc = this.processes.get(id);
    if (!proc) {
       throw new Error(`Process ${id} not found`);
    }
    return await proc.exited;
  }

  kill(id: string): void {
    const proc = this.processes.get(id);
    if (proc) {
      proc.kill();
      this.cleanup(id);
      console.log(`[ProcessManager] Killed process ${id}`);
    }
  }

  private cleanup(id: string) {
    this.processes.delete(id);
    this.pidMap.delete(id);
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

  /**
   * 查询进程状态
   */
  getStatus(id: string): { state: 'running' | 'exited' | 'unknown'; exitCode?: number; pid?: number } {
    const proc = this.processes.get(id);
    if (proc) {
      return { state: 'running', pid: this.pidMap.get(id) };
    }
    const exitCode = this.exitCodes.get(id);
    if (exitCode !== undefined) {
      return { state: 'exited', exitCode };
    }
    return { state: 'unknown' };
  }

  /**
   * 检查进程是否由指定身份创建
   * 如果进程没有记录创建者，则允许访问（向后兼容）
   */
  isOwnedBy(processId: string, creatorId: string): boolean {
    const owner = this.creatorMap.get(processId);
    if (!owner) return true; // 无所有者记录，允许访问
    return owner === creatorId;
  }
}
