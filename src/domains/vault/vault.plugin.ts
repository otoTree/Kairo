import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { Vault } from "./vault";
import type { AgentPlugin } from "../agent/agent.plugin";

export class VaultPlugin implements Plugin {
  readonly name = "vault";
  private vault: Vault = new Vault();
  private app?: Application;

  setup(app: Application) {
    this.app = app;
    app.registerService("vault", this.vault);
    console.log("[Vault] Vault service registered.");
  }

  start() {
    const agent = this.app?.getService<AgentPlugin>("agent");
    if (agent) {
        this.registerTools(agent);
    } else {
        console.warn("[Vault] AgentPlugin not found. Tools not registered.");
    }
  }

  private registerTools(agent: AgentPlugin) {
      agent.registerSystemTool({
          name: "vault_store",
          description: "Securely store a sensitive value and get a handle.",
          inputSchema: {
              type: "object",
              properties: {
                  value: { type: "string", description: "The sensitive value" },
                  type: { type: "string", description: "Type of secret (default: generic)" }
              },
              required: ["value"]
          }
      }, async (args) => {
          return this.vault.store(args.value, args.type);
      });

      agent.registerSystemTool({
          name: "vault_resolve",
          description: "Resolve a handle to its sensitive value. (Use with caution)",
          inputSchema: {
              type: "object",
              properties: {
                  handleId: { type: "string", description: "The handle ID (e.g. vault:xyz)" }
              },
              required: ["handleId"]
          }
      }, async (args) => {
          const value = this.vault.resolve(args.handleId);
          if (value === undefined) {
              throw new Error("Invalid handle or expired.");
          }
          return { value };
      });
      
      console.log("[Vault] Registered Vault Tools");
  }
}
