import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import type { AIPlugin } from "../ai/ai.plugin";
import type { MCPPlugin } from "../mcp/mcp.plugin";
import { InMemoryObservationBus, type ObservationBus } from "./observation-bus";
import { InMemoryAgentMemory, type AgentMemory } from "./memory";
import { AgentRuntime } from "./runtime";

export class AgentPlugin implements Plugin {
  readonly name = "agent";
  
  public readonly bus: ObservationBus;
  public readonly memory: AgentMemory;
  private runtime?: AgentRuntime;
  private app?: Application;
  private actionListeners: ((action: any) => void)[] = [];
  private logListeners: ((log: any) => void)[] = [];
  private actionResultListeners: ((result: any) => void)[] = [];

  constructor() {
    this.bus = new InMemoryObservationBus();
    this.memory = new InMemoryAgentMemory();
  }

  onAction(listener: (action: any) => void) {
    this.actionListeners.push(listener);
    return () => {
      this.actionListeners = this.actionListeners.filter(l => l !== listener);
    };
  }

  onLog(listener: (log: any) => void) {
    this.logListeners.push(listener);
    return () => {
      this.logListeners = this.logListeners.filter(l => l !== listener);
    };
  }

  onActionResult(listener: (result: any) => void) {
    this.actionResultListeners.push(listener);
    return () => {
      this.actionResultListeners = this.actionResultListeners.filter(l => l !== listener);
    };
  }

  setup(app: Application) {
    this.app = app;
    console.log("[Agent] Setting up Agent domain...");
    app.registerService("agent", this);
  }

  async start() {
    if (!this.app) {
      throw new Error("AgentPlugin not initialized");
    }

    console.log("[Agent] Starting Agent domain...");
    
    // Resolve AI dependency lazily in start()
    let ai: AIPlugin;
    let mcp: MCPPlugin | undefined;

    try {
      ai = this.app.getService<AIPlugin>("ai");
    } catch (e) {
      console.error("[Agent] AI service not found. Agent cannot start.");
      throw e;
    }

    try {
      mcp = this.app.getService<MCPPlugin>("mcp");
    } catch (e) {
      console.warn("[Agent] MCP service not found. Tools will be disabled.");
    }

    this.runtime = new AgentRuntime({
      ai,
      mcp,
      bus: this.bus,
      memory: this.memory,
      onAction: (action) => {
        this.actionListeners.forEach(listener => listener(action));
      },
      onLog: (log) => {
        this.logListeners.forEach(listener => listener(log));
      },
      onActionResult: (result) => {
        this.actionResultListeners.forEach(listener => listener(result));
      }
    });

    this.runtime.start();
  }

  async stop() {
    console.log("[Agent] Stopping Agent domain...");
    if (this.runtime) {
      this.runtime.stop();
    }
  }
}
