import type { Plugin } from "./plugin";

export class Application {
  private plugins: Map<string, Plugin> = new Map();
  private services: Map<string, any> = new Map();

  registerService<T>(name: string, service: T) {
    this.services.set(name, service);
    return this;
  }

  getService<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service ${name} not found.`);
    }
    return service;
  }

  async use(plugin: Plugin) {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already registered.`);
    }
    await plugin.setup(this);
    this.plugins.set(plugin.name, plugin);
    console.log(`[Core] Plugin registered: ${plugin.name}`);
    return this;
  }

  async start() {
    console.log("[Core] Application starting...");
    for (const plugin of this.plugins.values()) {
      if (plugin.start) {
        await plugin.start();
      }
    }
    console.log("[Core] Application started successfully.");
  }

  async stop() {
    console.log("[Core] Application stopping...");
    for (const plugin of this.plugins.values()) {
      if (plugin.stop) {
        await plugin.stop();
      }
    }
    console.log("[Core] Application stopped.");
  }
}
