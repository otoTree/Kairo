import { spawn, type Subprocess } from 'bun';
import { SandboxManager } from '../sandbox/sandbox-manager';
import { quote } from 'shell-quote';
import { EventEmitter } from 'node:events';

import { SandboxRuntimeConfig } from '../sandbox/sandbox-config';

export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  limits?: {
    cpu?: number;
    memory?: number;
  };
  sandbox?: SandboxRuntimeConfig;
}

export class ProcessManager extends EventEmitter {
  private processes = new Map<string, Subprocess>();
  private pidMap = new Map<string, number>();

  async spawn(id: string, command: string[], options: ProcessOptions = {}): Promise<void> {
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
    
    console.log(`[ProcessManager] Spawned process ${id} (PID: ${proc.pid})`);

    // Handle stdout
    if (proc.stdout) {
      this.streamToEvent(id, 'stdout', proc.stdout);
    }

    // Handle stderr
    if (proc.stderr) {
      this.streamToEvent(id, 'stderr', proc.stderr);
    }

    // Handle exit
    proc.exited.then((code) => {
        this.emit('exit', { id, code });
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
    if (proc && proc.stdin) {
      proc.stdin.write(data);
      proc.stdin.flush();
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
}
