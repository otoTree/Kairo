import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { MemCube } from "./memcube";
import { AIPlugin } from "../ai/ai.plugin";
import type { AgentPlugin } from "../agent/agent.plugin";

export class MemoryPlugin implements Plugin {
  readonly name = "memory";
  private memCube?: MemCube;
  private embeddingProviderName?: string;
  private app?: Application;

  constructor(embeddingProviderName?: string) {
    this.embeddingProviderName = embeddingProviderName;
  }

  setup(app: Application) {
    this.app = app;
    const ai = app.getService<AIPlugin>("ai");
    if (!ai) {
      throw new Error("MemoryPlugin requires AIPlugin");
    }
    this.memCube = new MemCube(ai, this.embeddingProviderName);
    app.registerService("memCube", this.memCube);
    console.log(`[Memory] MemCube service registered (Provider: ${this.embeddingProviderName || "default"}).`);
  }

  start() {
    console.log("[Memory] Memory domain active.");
    
    // Register tools
    const agent = this.app?.getService<AgentPlugin>("agent");
    if (agent) {
        this.registerTools(agent);
    } else {
        console.warn("[Memory] AgentPlugin not found. Tools not registered.");
    }
  }

  private registerTools(agent: AgentPlugin) {
      if (!this.memCube) return;

      agent.registerSystemTool({
          name: "memory_add",
          description: "Add a new memory entry to long-term storage (MemCube).",
          inputSchema: {
              type: "object",
              properties: {
                  content: { type: "string", description: "The content to memorize" },
                  metadata: { type: "object", description: "Optional metadata (key-value pairs)", additionalProperties: true }
              },
              required: ["content"]
          }
      }, async (args) => {
          const id = await this.memCube!.add(args.content, args.metadata);
          return { id, status: "success" };
      });

      agent.registerSystemTool({
          name: "memory_recall",
          description: "Recall memories semantically related to the query.",
          inputSchema: {
              type: "object",
              properties: {
                  query: { type: "string", description: "Search query" },
                  limit: { type: "number", description: "Max number of results (default 5)" },
                  threshold: { type: "number", description: "Similarity threshold (0-1, default 0.7)" }
              },
              required: ["query"]
          }
      }, async (args) => {
          const entries = await this.memCube!.recall({
              text: args.query,
              limit: args.limit,
              threshold: args.threshold
          });
          return { entries };
      });
      
      console.log("[Memory] Registered Memory Tools");
  }
}
