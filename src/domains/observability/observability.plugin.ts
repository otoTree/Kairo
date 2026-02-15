import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import type { LogEntry } from "./types";
import { KairoLogger } from "./logger";
import type { KairoEvent } from "../events";
import type { AgentPlugin } from "../agent/agent.plugin";
import type { KernelPlugin } from "../kernel/kernel.plugin";
import fs from "fs/promises";
import path from "path";

class RingBuffer<T> {
  private buffer: T[];
  private capacity: number;
  private head: number = 0;
  private size: number = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.size; i++) {
        const index = (this.head - this.size + i + this.capacity) % this.capacity;
        result.push(this.buffer[index]!);
    }
    return result;
  }
}

export class ObservabilityPlugin implements Plugin {
  readonly name = "observability";
  private app?: Application;
  private logBuffer = new RingBuffer<LogEntry>(1000);
  private eventBuffer = new RingBuffer<KairoEvent>(1000);

  setup(app: Application) {
    this.app = app;
    app.registerService("observability", this);
    
    // Subscribe to Logs
    KairoLogger.addListener((entry) => {
        this.logBuffer.push(entry);
    });
  }

  async start() {
    console.log("[Observability] Starting...");
    const agent = this.app?.getService<AgentPlugin>("agent");
    if (agent) {
        // Subscribe to all events
        agent.globalBus.subscribe("*", (event) => {
            this.eventBuffer.push(event as KairoEvent);
        });

        // Register Diagnostic Tool
        agent.registerSystemTool({
            name: "system_create_snapshot",
            description: "Create a diagnostic snapshot of the system state.",
            inputSchema: { type: "object", properties: {} }
        }, async () => {
            return await this.createSnapshot();
        });
    } else {
        console.warn("[Observability] AgentPlugin not found. Event collection disabled.");
    }
  }

  async stop() {
      // Nothing to stop
  }

  async createSnapshot() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `kairo-snapshot-${timestamp}.json`;
    const filepath = path.join(process.cwd(), "snapshots", filename);
    
    const snapshot = {
        meta: {
            timestamp: new Date().toISOString(),
            platform: process.platform,
            nodeVersion: process.version,
        },
        logs: this.logBuffer.toArray(),
        events: this.eventBuffer.toArray(),
        system: await this.getSystemInfo(),
        processes: this.getProcessInfo(),
    };

    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(snapshot, null, 2));
    
    console.log(`[Observability] Snapshot created at ${filepath}`);
    return { path: filepath, size: (await fs.stat(filepath)).size };
  }

  private async getSystemInfo() {
      try {
        const kernel = this.app?.getService<KernelPlugin>("kernel");
        if (kernel) {
            return await kernel.systemMonitor.getMetrics();
        }
      } catch (e) {
          // Ignore if kernel not available
      }
      return null;
  }

  private getProcessInfo() {
      try {
        const kernel = this.app?.getService<KernelPlugin>("kernel");
        if (kernel) {
            return {
                sessions: kernel.shellManager.listSessions()
            };
        }
      } catch (e) {
          // Ignore
      }
      return null;
  }
}
