import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { MemCube } from "./memcube";
import { AIPlugin } from "../ai/ai.plugin";
import type { AgentPlugin } from "../agent/agent.plugin";

import path from "path";

import { MemoryLayer } from "./types";

export class MemoryPlugin implements Plugin {
  readonly name = "memory";
  private memCube?: MemCube;
  private embeddingProviderName?: string;
  private app?: Application;
  private storagePath?: string;

  constructor(embeddingProviderName?: string, storagePath?: string) {
    this.embeddingProviderName = embeddingProviderName;
    this.storagePath = storagePath;
  }

  async setup(app: Application) {
    this.app = app;
    const ai = app.getService<AIPlugin>("ai");
    if (!ai) {
      throw new Error("MemoryPlugin requires AIPlugin");
    }
    // Default storage path: /data/memcube relative to CWD
    const finalStoragePath = this.storagePath || path.join(process.cwd(), "data", "memcube");
    
    this.memCube = new MemCube(ai, this.embeddingProviderName, finalStoragePath);
    await this.memCube.init(); // Initialize storage
    
    app.registerService("memCube", this.memCube);
    console.log(`[Memory] MemCube service registered (Provider: ${this.embeddingProviderName || "default"}, Path: ${finalStoragePath}).`);
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
          description: "Add a new memory entry to MemCube.",
          inputSchema: {
              type: "object",
              properties: {
                  content: { type: "string", description: "The content to memorize" },
                  namespace: { type: "string", description: "命名空间，用于多 Agent 隔离（默认 default）" },
                  layer: { type: "string", enum: ["L1", "L2", "L3"], description: "Memory Layer (L1: Working, L2: Episodic, L3: Semantic). Default: L2" },
                  importance: { type: "number", description: "Importance (1-10)" },
                  metadata: { type: "object", description: "Optional metadata", additionalProperties: true }
              },
              required: ["content"]
          }
      }, async (args) => {
          const id = await this.memCube!.add(args.content, {
              namespace: args.namespace,
              layer: args.layer as MemoryLayer,
              attributes: args.importance ? { importance: args.importance } : undefined,
              metadata: args.metadata
          });
          return { id, status: "success" };
      });

      agent.registerSystemTool({
          name: "memory_recall",
          description: "Recall memories using hybrid retrieval (Vector + Keyword).",
          inputSchema: {
              type: "object",
              properties: {
                  query: { type: "string", description: "Search query" },
                  namespace: { type: "string", description: "限定命名空间" },
                  limit: { type: "number", description: "Max number of results (default 5)" },
                  threshold: { type: "number", description: "Similarity threshold (0-1, default 0.0)" },
                  layer: { type: "array", items: { type: "string", enum: ["L1", "L2", "L3"] }, description: "Filter by layers" },
                  minImportance: { type: "number", description: "Filter by minimum importance" },
                  before: { type: "number", description: "Time Travel: Only memories created before timestamp" },
                  after: { type: "number", description: "Only memories created after timestamp" }
              },
              required: ["query"]
          }
      }, async (args) => {
          const entries = await this.memCube!.recall({
              text: args.query,
              namespace: args.namespace,
              limit: args.limit,
              threshold: args.threshold,
              filter: {
                  layer: args.layer as MemoryLayer[],
                  minImportance: args.minImportance,
                  before: args.before,
                  after: args.after
              }
          });
          return { entries };
      });
    
          agent.registerSystemTool({
              name: "memory_consolidate",
              description: "Trigger manual consolidation of memories.",
              inputSchema: {
                  type: "object",
                  properties: {
                      batchSize: { type: "number", description: "Number of memories to consolidate" }
                  }
              }
          }, async (args) => {
              const summaryIds = await this.memCube!.consolidate({ batchSize: args.batchSize });
              return { status: "success", summaryIds };
          });
    
          agent.registerSystemTool({
              name: "memory_reinforce",
          description: "Reinforce a memory (adjust importance/strength) based on feedback.",
          inputSchema: {
              type: "object",
              properties: {
                  id: { type: "string", description: "Memory ID" },
                  feedback: { type: "string", enum: ["positive", "negative", "access"], description: "Feedback type" }
              },
              required: ["id", "feedback"]
          }
      }, async (args) => {
          await this.memCube!.reinforce(args.id, args.feedback as any);
          return { status: "success" };
      });

      // 跨命名空间共享记忆
      agent.registerSystemTool({
          name: "memory_share",
          description: "跨命名空间共享记忆",
          inputSchema: {
              type: "object",
              properties: {
                  fromNamespace: { type: "string", description: "源命名空间" },
                  toNamespace: { type: "string", description: "目标命名空间" },
                  memoryId: { type: "string", description: "记忆 ID" }
              },
              required: ["fromNamespace", "toNamespace", "memoryId"]
          }
      }, async (args) => {
          const newId = await this.memCube!.share(args.fromNamespace, args.toNamespace, args.memoryId);
          return { newId, status: "success" };
      });

      // 导出记忆
      agent.registerSystemTool({
          name: "memory_export",
          description: "导出记忆为 JSON 格式",
          inputSchema: {
              type: "object",
              properties: {
                  namespace: { type: "string", description: "限定命名空间（可选）" }
              }
          }
      }, async (args) => {
          const data = await this.memCube!.exportMemories(args.namespace);
          return { data };
      });

      // 导入记忆
      agent.registerSystemTool({
          name: "memory_import",
          description: "从 JSON 数据导入记忆",
          inputSchema: {
              type: "object",
              properties: {
                  data: { type: "string", description: "JSON 格式的记忆数据" }
              },
              required: ["data"]
          }
      }, async (args) => {
          const count = await this.memCube!.importMemories(args.data);
          return { count, status: "success" };
      });
      
      console.log("[Memory] Registered Memory Tools");
  }
}
