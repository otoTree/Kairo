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
import { ServiceManager } from "./service-manager";
import { DBusBridge } from "./dbus-bridge";

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
  public readonly serviceManager: ServiceManager;
  public readonly dbusBridge: DBusBridge;
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
    this.serviceManager = new ServiceManager(this.processManager);
    this.dbusBridge = new DBusBridge();
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

      // 注入 EventBus 到 IPC Server，启用 topic 订阅桥接
      this.ipcServer.setEventBus(agentPlugin.globalBus);

      rootLogger.info("[Kernel] Started Event Bridge");

      // Register System Tools
      this.registerTerminalTools(agentPlugin);
      this.registerStateTools(agentPlugin);
      this.registerProcessIOTools(agentPlugin);
      this.registerServiceTools(agentPlugin);
      this.registerDBusTools(agentPlugin);

      // 启动 D-Bus 桥接
      await this.dbusBridge.connect(agentPlugin.globalBus).catch((e: unknown) => {
        rootLogger.warn("[Kernel] D-Bus bridge failed to connect:", e);
      });

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

  /**
   * 注册 Process IO 系统工具，让 Agent 能与子进程全双工通信
   */
  private registerProcessIOTools(agent: AgentPlugin) {
    // kairo_process_write — 向子进程 stdin 写入数据
    agent.registerSystemTool({
      name: "kairo_process_write",
      description: "Write data to a child process stdin.",
      inputSchema: {
        type: "object",
        properties: {
          processId: { type: "string", description: "Process ID" },
          data: { type: "string", description: "Data to write to stdin" },
        },
        required: ["processId", "data"]
      }
    }, async (args) => {
      this.processManager.writeToStdin(args.processId, args.data);
      return { status: "written", processId: args.processId };
    });

    // kairo_process_status — 查询进程状态
    agent.registerSystemTool({
      name: "kairo_process_status",
      description: "Query the status of a child process.",
      inputSchema: {
        type: "object",
        properties: {
          processId: { type: "string", description: "Process ID" },
        },
        required: ["processId"]
      }
    }, async (args) => {
      return this.processManager.getStatus(args.processId);
    });

    // kairo_process_wait — 等待进程退出
    agent.registerSystemTool({
      name: "kairo_process_wait",
      description: "Wait for a child process to exit. Returns exit code.",
      inputSchema: {
        type: "object",
        properties: {
          processId: { type: "string", description: "Process ID" },
        },
        required: ["processId"]
      }
    }, async (args) => {
      const exitCode = await this.processManager.wait(args.processId);
      return { exitCode, processId: args.processId };
    });

    rootLogger.info("[Kernel] Registered Process IO Tools");
  }

  /**
   * 注册服务管理工具
   */
  private registerServiceTools(agent: AgentPlugin) {
    agent.registerSystemTool({
      name: "kairo_service_list",
      description: "列出所有已注册的服务及其状态",
      inputSchema: { type: "object", properties: {} },
    }, async () => {
      return { services: this.serviceManager.listServices() };
    });

    agent.registerSystemTool({
      name: "kairo_service_restart",
      description: "重启指定服务",
      inputSchema: {
        type: "object",
        properties: { serviceId: { type: "string", description: "服务 ID" } },
        required: ["serviceId"],
      },
    }, async (args) => {
      await this.serviceManager.restartService(args.serviceId);
      return { status: "restarted", serviceId: args.serviceId };
    });

    rootLogger.info("[Kernel] Registered Service Management Tools");
  }

  /**
   * 注册 D-Bus 相关工具（systemd 控制、网络查询）
   */
  private registerDBusTools(agent: AgentPlugin) {
    agent.registerSystemTool({
      name: "kairo_systemd_status",
      description: "查询 systemd 服务状态",
      inputSchema: {
        type: "object",
        properties: { unitName: { type: "string", description: "服务单元名，如 nginx.service" } },
        required: ["unitName"],
      },
    }, async (args) => {
      return await this.dbusBridge.getUnitStatus(args.unitName);
    });

    agent.registerSystemTool({
      name: "kairo_systemd_control",
      description: "控制 systemd 服务（start/stop/restart）",
      inputSchema: {
        type: "object",
        properties: {
          unitName: { type: "string", description: "服务单元名" },
          action: { type: "string", description: "操作：start / stop / restart" },
        },
        required: ["unitName", "action"],
      },
    }, async (args) => {
      switch (args.action) {
        case 'start': return await this.dbusBridge.startUnit(args.unitName);
        case 'stop': return await this.dbusBridge.stopUnit(args.unitName);
        case 'restart': return await this.dbusBridge.restartUnit(args.unitName);
        default: throw new Error(`未知操作: ${args.action}`);
      }
    });

    agent.registerSystemTool({
      name: "kairo_network_status",
      description: "查询网络连接状态（通过 NetworkManager）",
      inputSchema: { type: "object", properties: {} },
    }, async () => {
      return await this.dbusBridge.getNetworkState();
    });

    rootLogger.info("[Kernel] Registered D-Bus Tools");
  }
}
