import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { DeviceMonitor } from "./monitor";
import type { DeviceRegistry } from "./registry";
import { DeviceManager } from "./manager";
import type { AgentPlugin } from "../agent/agent.plugin";
import type { EventBus } from "../events/types";

export class DevicePlugin implements Plugin {
  name = "device";
  private monitor?: DeviceMonitor;
  private manager?: DeviceManager;
  private app?: Application;

  setup(app: Application): void {
    this.app = app;
    app.registerService("device", this);
  }

  async start(): Promise<void> {
      if (!this.app) return;

      try {
          const registry = this.app.getService<DeviceRegistry>("deviceRegistry");
          if (!registry) {
              console.error("[DevicePlugin] DeviceRegistry not found");
              return;
          }

          this.monitor = new DeviceMonitor(registry);
          await this.monitor.start();
          console.log("[DevicePlugin] Started Device Monitor");

          this.manager = new DeviceManager(registry);
          this.app.registerService("deviceManager", this.manager);
          console.log("[DevicePlugin] Started Device Manager");

          // 桥接热插拔事件到 EventBus
          this.bridgeHotplugEvents(registry);

          // 注册 Agent 系统工具
          this.registerAgentTools(registry);

      } catch (e) {
          console.error("[DevicePlugin] Failed to start:", e);
      }
  }

  /**
   * 桥接设备热插拔事件到 EventBus，让 Agent 能感知设备变化
   */
  private bridgeHotplugEvents(registry: DeviceRegistry): void {
    try {
      const agent = this.app!.getService<AgentPlugin>("agent");
      const bus: EventBus = agent.globalBus;

      registry.events.on('device:connected', (device) => {
        bus.publish({
          type: 'kairo.device.connected',
          source: 'device-plugin',
          data: { id: device.id, type: device.type, path: device.path, hardwareId: device.hardwareId },
        });
      });

      registry.events.on('device:disconnected', (payload) => {
        bus.publish({ type: 'kairo.device.disconnected', source: 'device-plugin', data: payload });
      });

      registry.events.on('device:claimed', (payload) => {
        bus.publish({ type: 'kairo.device.claimed', source: 'device-plugin', data: payload });
      });

      registry.events.on('device:released', (payload) => {
        bus.publish({ type: 'kairo.device.released', source: 'device-plugin', data: payload });
      });

      console.log("[DevicePlugin] Hot-plug events bridged to EventBus");
    } catch {
      console.warn("[DevicePlugin] AgentPlugin not found, hot-plug bridge disabled");
    }
  }

  /**
   * 注册设备管理系统工具，让 Agent 能操作设备
   */
  private registerAgentTools(registry: DeviceRegistry): void {
    try {
      const agent = this.app!.getService<AgentPlugin>("agent");

      agent.registerSystemTool({
        name: "kairo_device_list",
        description: "列出所有可用设备及其状态",
        inputSchema: { type: "object", properties: {} },
      }, async () => {
        return { devices: registry.list() };
      });

      agent.registerSystemTool({
        name: "kairo_device_claim",
        description: "声明设备独占访问权限",
        inputSchema: {
          type: "object",
          properties: { deviceId: { type: "string", description: "设备 ID" } },
          required: ["deviceId"],
        },
      }, async (args, context) => {
        const ownerId = context?.agentId || 'default';
        await registry.claim(args.deviceId, ownerId);
        return { success: true, deviceId: args.deviceId };
      });

      agent.registerSystemTool({
        name: "kairo_device_release",
        description: "释放设备访问权限",
        inputSchema: {
          type: "object",
          properties: { deviceId: { type: "string", description: "设备 ID" } },
          required: ["deviceId"],
        },
      }, async (args, context) => {
        const ownerId = context?.agentId || 'default';
        if (this.manager) await this.manager.releaseDriver(args.deviceId);
        await registry.release(args.deviceId, ownerId);
        return { success: true, deviceId: args.deviceId };
      });

      agent.registerSystemTool({
        name: "kairo_device_write",
        description: "向已声明的设备写入数据",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string", description: "设备 ID" },
            data: { type: "string", description: "要写入的数据" },
          },
          required: ["deviceId", "data"],
        },
      }, async (args) => {
        if (!this.manager) throw new Error("DeviceManager not initialized");
        const driver = await this.manager.getDriver(args.deviceId);
        await driver.write(args.data);
        return { success: true, deviceId: args.deviceId };
      });

      console.log("[DevicePlugin] Registered Agent device tools");
    } catch {
      console.warn("[DevicePlugin] AgentPlugin not found, device tools disabled");
    }
  }

  async stop() {
      if (this.monitor) {
          this.monitor.stop();
      }
  }
}
