import { spawn, type Subprocess } from "bun";
import { EventEmitter } from "node:events";

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: string; // default: /bin/bash or /bin/zsh
}

export interface CommandResult {
  output: string;
  exitCode: number;
}

/**
 * ShellSession manages a persistent shell process (bash/zsh).
 * It uses a sentinel-based approach to detect command completion.
 */
export class ShellSession extends EventEmitter {
  public readonly id: string;
  private process: Subprocess;
  private buffer: string = "";
  private currentResolver: ((result: CommandResult) => void) | null = null;
  private sentinel: string;
  private isBusy: boolean = false;

  constructor(id: string, options: ShellOptions = {}) {
    super();
    this.id = id;
    this.sentinel = `__KAIRO_SENTINEL_${crypto.randomUUID().replace(/-/g, "")}__`;
    
    const shell = options.shell || "/bin/bash"; // bash is safer for scripting than zsh usually
    const cwd = options.cwd || process.cwd();
    
    // We explicitly set PS1 to empty to avoid prompt pollution in output,
    // although we rely on sentinel for separation.
    const env = { 
      ...process.env, 
      ...options.env,
      PS1: "", 
      TERM: "dumb" 
    };

    console.log(`[ShellSession:${id}] Spawning ${shell} in ${cwd}`);
    
    this.process = spawn([shell], {
      cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe", // Merge stderr into stdout? Or handle separately?
                      // For simplicity, we'll try to merge or read both. 
                      // Bun doesn't support 'inherit' mixed with 'pipe' easily for merging.
                      // We'll pipe both and handle them.
    });

    this.setupStreams();
  }

  private setupStreams() {
    if (!this.process.stdout || !this.process.stderr) {
      throw new Error("Failed to open shell streams");
    }

    // Bun types for spawn stdio can be number or stream depending on options.
    // We set 'pipe', so they should be streams.
    const stdout = this.process.stdout as ReadableStream<Uint8Array>;
    const stderr = this.process.stderr as ReadableStream<Uint8Array>;

    const handleOutput = async (reader: any) => {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          this.buffer += chunk;
          this.checkSentinel();
        }
      } catch (e) {
        console.error(`[ShellSession:${this.id}] Stream error:`, e);
      }
    };

    handleOutput(stdout.getReader());
    handleOutput(stderr.getReader());
    
    this.process.exited.then((code) => {
      console.log(`[ShellSession:${this.id}] Exited with code ${code}`);
      this.emit("exit", code);
    });
  }

  private checkSentinel() {
    if (!this.currentResolver) return;

    // We look for: <sentinel> <exitCode>\n
    // The command sequence sent is: <command>; echo "<sentinel> $?"
    
    // Regex: __SENTINEL__ (\d+)\n?
    const sentinelRegex = new RegExp(`${this.sentinel}\\s+(\\d+)[\\r\\n]*$`);
    const match = this.buffer.match(sentinelRegex);

    if (match) {
      const fullMatch = match[0];
      const exitCode = parseInt(match[1] || "0", 10);
      
      // Extract output before sentinel
      const index = match.index ?? 0;
      const output = this.buffer.substring(0, index).trim();
      
      // Reset buffer (keep anything after sentinel? unlikely in sync mode but possible)
      this.buffer = this.buffer.substring(index + fullMatch.length);
      
      const resolver = this.currentResolver;
      this.currentResolver = null;
      this.isBusy = false;
      
      resolver({ output, exitCode });
    }
  }

  /**
   * Execute a command in the shell session and wait for it to complete.
   */
  async exec(command: string, timeout: number = 30000): Promise<CommandResult> {
    if (this.isBusy) {
      throw new Error("Shell session is busy executing another command.");
    }

    if (this.process.killed) {
        throw new Error("Shell session is closed.");
    }

    this.isBusy = true;
    this.buffer = ""; // Clear previous buffer remnants
    
    return new Promise<CommandResult>((resolve, reject) => {
      this.currentResolver = resolve;
      
      // Safety timeout
      const timer = setTimeout(() => {
        if (this.currentResolver === resolve) {
          this.currentResolver = null;
          this.isBusy = false;
          reject(new Error(`Command timed out after ${timeout}ms`));
          // Potentially kill/restart shell here?
        }
      }, timeout);

      // Wrap resolve to clear timer
      const originalResolve = resolve;
      this.currentResolver = (res) => {
        clearTimeout(timer);
        originalResolve(res);
      };

      // Construct command with sentinel
      // We use brace expansion or just semicolon to ensure echo runs
      // But we need to handle syntax errors in command.
      // "command; echo SENTINEL $?" ensures echo runs even if command fails.
      const cmdSequence = `${command}\n echo "${this.sentinel} $?"\n`;
      
      // Bun FileSink casting
    const stdin = this.process.stdin as any; 
      
    if (stdin) {
        stdin.write(new TextEncoder().encode(cmdSequence));
        stdin.flush();
    } else {
        reject(new Error("Stdin not available"));
    }
    });
  }

  kill() {
    this.process.kill();
  }
}

export class ShellManager {
  private sessions = new Map<string, ShellSession>();

  createSession(id: string = "default"): ShellSession {
    if (this.sessions.has(id)) {
      // Return existing or error? 
      // For now, return existing.
      return this.sessions.get(id)!;
    }
    
    const session = new ShellSession(id);
    this.sessions.set(id, session);
    
    session.on("exit", () => {
      this.sessions.delete(id);
    });

    return session;
  }

  getSession(id: string): ShellSession | undefined {
    return this.sessions.get(id);
  }

  killSession(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      session.kill();
      this.sessions.delete(id);
    }
  }
  
  listSessions(): string[] {
      return Array.from(this.sessions.keys());
  }
}
