import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { SandboxManager } from "./sandbox-manager";

export class SandboxPlugin implements Plugin {
  readonly name = "sandbox";
  private app?: Application;

  setup(app: Application) {
    this.app = app;
    console.log("[Sandbox] Setting up Sandbox domain...");
    app.registerService("sandbox", SandboxManager);
  }

  async start() {
    console.log("[Sandbox] Starting Sandbox domain...");
    // Ensure clean state on start
    await SandboxManager.reset();
  }

  async stop() {
    console.log("[Sandbox] Stopping Sandbox domain...");
    await SandboxManager.reset();
  }
}
