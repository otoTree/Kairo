import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { DeviceMonitor } from "./monitor";
import type { DeviceRegistry } from "./registry";
import { DeviceManager } from "./manager";

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
          // Get shared registry from KernelPlugin
          const registry = this.app.getService<DeviceRegistry>("deviceRegistry");
          if (!registry) {
              console.error("[DevicePlugin] DeviceRegistry not found (KernelPlugin not loaded?)");
              return;
          }

          this.monitor = new DeviceMonitor(registry);
          await this.monitor.start();
          console.log("[DevicePlugin] Started Device Monitor");

          this.manager = new DeviceManager(registry);
          this.app.registerService("deviceManager", this.manager);
          console.log("[DevicePlugin] Started Device Manager");

      } catch (e) {
          console.error("[DevicePlugin] Failed to start:", e);
      }
  }

  async stop() {
      if (this.monitor) {
          this.monitor.stop();
      }
  }
}
