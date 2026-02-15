import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { SystemMonitor } from "./system-info";
import { DeviceRegistry } from "../device/registry";
import { ProcessManager } from "./process-manager";
import { KernelEventBridge } from "./bridge";
import { ShellManager } from "./terminal/shell";
import { IPCServer } from "./ipc-server";
import type { AgentPlugin } from "../agent/agent.plugin";
import { StateRepository } from "../database/repositories/state-repository";
import { CheckpointRepository } from "../database/repositories/checkpoint-repository";
import { KernelStateManager } from "./state-manager";

import { Vault } from "../vault/vault";
import { rootLogger } from "../observability/logger";

export class KernelPlugin implements Plugin {
  name = "kernel";
  
  public readonly systemMonitor: SystemMonitor;
  public readonly deviceRegistry: DeviceRegistry;
  public readonly processManager: ProcessManager;
  public readonly shellManager: ShellManager;
  public readonly ipcServer: IPCServer;
  public readonly stateRepository: StateRepository;
  public readonly checkpointRepository: CheckpointRepository;
  public readonly stateManager: KernelStateManager;
  private bridge?: KernelEventBridge;

  private app?: Application;

  constructor() {
    this.stateRepository = new StateRepository();
    this.checkpointRepository = new CheckpointRepository();
    this.systemMonitor = new SystemMonitor();
    this.deviceRegistry = new DeviceRegistry(undefined, this.stateRepository);
    this.processManager = new ProcessManager(this.stateRepository);
    this.shellManager = new ShellManager();
    this.ipcServer = new IPCServer(this.processManager, this.systemMonitor, this.deviceRegistry);
    this.stateManager = new KernelStateManager(this.stateRepository, this.checkpointRepository);
  }

  setup(app: Application): void {
    this.app = app;
    app.registerService("kernel", this);
    // Expose deviceRegistry so DevicePlugin can use it
    app.registerService("deviceRegistry", this.deviceRegistry);
    
    try {
        const vault = app.getService<Vault>("vault");
        this.ipcServer.setVault(vault);
    } catch (e) {
        rootLogger.warn("[Kernel] Vault service not available.");
    }

    this.registerTools();
  }

  private registerTools() {
      // We need to wait for AgentPlugin to be available if we want to register system tools directly.
      // But setup() order matters. If AgentPlugin is setup later, we can't get it here.
      // We should probably register tools in start().
  }

  async start(): Promise<void> {
    if (!this.app) return;

    // Recover state
    await this.processManager.recover();
    await this.deviceRegistry.recover();

    // Start IPC Server
    try {
        await this.ipcServer.start();
    } catch (e) {
        rootLogger.error("[Kernel] Failed to start IPC Server:", e);
    }

    // Start System Monitor Polling
    this.systemMonitor.startPolling();
    
    // Find AgentPlugin to get the bus
    try {
      const agentPlugin = this.app.getService<AgentPlugin>("agent");
      
      this.bridge = new KernelEventBridge(
        agentPlugin.globalBus,
        this.deviceRegistry,
        this.systemMonitor
      );
  
      this.bridge.start();
      rootLogger.info("[Kernel] Started Event Bridge");

      // Register System Tools
      this.registerTerminalTools(agentPlugin);
      this.registerStateTools(agentPlugin);

    } catch (e) {
      rootLogger.warn("[Kernel] AgentPlugin not found. Event Bridge & Tools disabled.");
    }
  }


  private registerTerminalTools(agent: AgentPlugin) {
    // 1. kairo_terminal_create
    agent.registerSystemTool({
      name: "kairo_terminal_create",
      description: "Create a new persistent shell session (bash/zsh). Returns session ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Optional session ID" }
        }
      }
    }, async (args) => {
      const id = args.id || `term_${crypto.randomUUID().slice(0, 8)}`;
      this.shellManager.createSession(id);
      return { sessionId: id, status: "created" };
    });

    // 2. kairo_terminal_exec
    agent.registerSystemTool({
      name: "kairo_terminal_exec",
      description: "Execute a command in a persistent shell session. Maintains state (cwd, env).",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session ID to execute in" },
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in ms (default 30000)" }
        },
        required: ["sessionId", "command"]
      }
    }, async (args, context) => {
      const session = this.shellManager.getSession(args.sessionId);
      if (!session) {
        throw new Error(`Session ${args.sessionId} not found. Create one first.`);
      }
      
      const env: Record<string, string> = {};
      if (context.traceId) env['KAIRO_TRACE_ID'] = context.traceId;
      if (context.spanId) env['KAIRO_SPAN_ID'] = context.spanId;
      
      return await session.exec(args.command, { timeout: args.timeout, env });
    });

    // 3. kairo_terminal_list
    agent.registerSystemTool({
      name: "kairo_terminal_list",
      description: "List active shell sessions.",
      inputSchema: { type: "object", properties: {} }
    }, async () => {
      return this.shellManager.listSessions();
    });
    
    // 4. kairo_terminal_kill
    agent.registerSystemTool({
      name: "kairo_terminal_kill",
      description: "Kill a shell session.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string" } },
        required: ["sessionId"]
      }
    }, async (args) => {
      this.shellManager.killSession(args.sessionId);
      return { status: "killed" };
    });
    
    rootLogger.info("[Kernel] Registered Terminal Tools");
  }

  private registerStateTools(agent: AgentPlugin) {
    agent.registerSystemTool({
      name: "kairo_state_save",
      description: "Save current system state checkpoint.",
      inputSchema: { type: "object", properties: {} }
    }, async () => {
      const id = await this.stateManager.saveCheckpoint();
      return { content: `Checkpoint saved: ${id}` };
    });
    
    agent.registerSystemTool({
      name: "kairo_state_restore",
      description: "Restore system state from checkpoint.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      }
    }, async (params: any) => {
      await this.stateManager.restoreCheckpoint(params.id);
      return { content: `Checkpoint restored: ${params.id}. Please restart Kernel.` };
    });
  }
}
