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
        // 注入 EventBus 启用审计日志
        this.vault.setEventBus(agent.globalBus);
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
          description: "通过 token 解析 vault handle 获取敏感值",
          inputSchema: {
              type: "object",
              properties: {
                  handleId: { type: "string", description: "The handle ID (e.g. vault:xyz)" },
                  token: { type: "string", description: "运行时 token（可选，Agent 直接调用时可省略）" }
              },
              required: ["handleId"]
          }
      }, async (args) => {
          // Agent 直接调用时使用 deprecated resolve（向后兼容）
          // Skill 进程通过 IPC 调用时使用 resolveWithToken
          if (args.token) {
              const value = this.vault.resolveWithToken(args.token, args.handleId);
              if (value === undefined) throw new Error("访问被拒绝或句柄无效");
              return { value };
          }
          const value = this.vault.resolve(args.handleId);
          if (value === undefined) throw new Error("Invalid handle or expired.");
          return { value };
      });
      
      console.log("[Vault] Registered Vault Tools");
  }
}
