import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import type { AIPlugin } from "../ai/ai.plugin";
import type { AgentPlugin } from "../agent/agent.plugin";
import { MemoryStore } from "./memory-store";
import { MemoryLayer } from "./types";
import path from "path";

export class MemoryPlugin implements Plugin {
  readonly name = "memory";
  private store?: MemoryStore;
  private app?: Application;
  private storagePath?: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath;
  }

  async setup(app: Application) {
    this.app = app;
    const finalPath = this.storagePath || path.join(process.cwd(), "data", "memory");

    // AIPlugin 可选，用于 consolidate
    let ai: AIPlugin | undefined;
    try { ai = app.getService<AIPlugin>("ai"); } catch {}

    this.store = new MemoryStore(finalPath, ai);
    await this.store.init();

    app.registerService("memoryStore", this.store);
    console.log(`[Memory] MemoryStore initialized at ${finalPath}`);
  }

  start() {
    const agent = this.app?.getService<AgentPlugin>("agent");
    if (agent) {
      this.registerTools(agent);
    } else {
      console.warn("[Memory] AgentPlugin not found.");
    }
  }

  private registerTools(agent: AgentPlugin) {
    if (!this.store) return;

    // memory_add — 添加记忆（可指定层级和重要性）
    agent.registerSystemTool({
      name: "memory_add",
      description: "记住一条信息。importance ≥ 8 的情景记忆会自动晋升为闪光灯记忆。",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "要记住的内容" },
          namespace: { type: "string", description: "命名空间（默认 default）" },
          layer: {
            type: "string",
            enum: Object.values(MemoryLayer),
            description: "记忆层级：working(短期), episodic(经历), semantic(知识), flashbulb(核心时刻)"
          },
          importance: { type: "number", description: "重要性 1-10（默认 5）" },
          tags: { type: "array", items: { type: "string" }, description: "标签" }
        },
        required: ["content"]
      }
    }, async (args: any) => {
      const id = await this.store!.add(args.content, {
        namespace: args.namespace,
        layer: args.layer as MemoryLayer,
        importance: args.importance,
        tags: args.tags,
      });
      return { id, status: "success" };
    });

    // memory_recall — 关键词搜索（跨层级，importance 加权）
    agent.registerSystemTool({
      name: "memory_recall",
      description: "通过关键词搜索记忆，支持按层级和重要性过滤。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          namespace: { type: "string", description: "命名空间" },
          layer: { type: "string", enum: Object.values(MemoryLayer), description: "限定层级" },
          minImportance: { type: "number", description: "最低重要性" },
          tags: { type: "array", items: { type: "string" }, description: "限定标签" },
          limit: { type: "number", description: "最大返回数量（默认 10）" }
        },
        required: ["query"]
      }
    }, async (args: any) => {
      const results = await this.store!.recall({
        text: args.query,
        layer: args.layer as MemoryLayer,
        minImportance: args.minImportance,
        tags: args.tags,
        limit: args.limit,
      }, args.namespace);
      const items = results as any[];
      return {
        results: items.map((r: any) => ({
          id: r.entry.id, content: r.entry.content,
          layer: r.entry.layer, importance: r.entry.importance, score: r.score
        }))
      };
    });

    // memory_forget — 删除记忆
    agent.registerSystemTool({
      name: "memory_forget",
      description: "删除一条记忆。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "记忆 ID" },
          namespace: { type: "string", description: "命名空间" }
        },
        required: ["id"]
      }
    }, async (args: any) => {
      const deleted = await this.store!.forget(args.id, args.namespace);
      return { deleted, status: deleted ? "success" : "not_found" };
    });

    // memory_list — 列出记忆
    agent.registerSystemTool({
      name: "memory_list",
      description: "列出记忆条目，可按层级过滤。",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "命名空间" },
          layer: { type: "string", enum: Object.values(MemoryLayer), description: "限定层级" }
        }
      }
    }, async (args: any) => {
      const entries = await this.store!.list(args.namespace, args.layer as MemoryLayer);
      return {
        entries: entries.map(e => ({
          id: e.id, content: e.content, layer: e.layer,
          importance: e.importance, tags: e.tags
        }))
      };
    });

    // memory_consolidate — 将 L2 情景记忆固化为 L3 语义摘要
    agent.registerSystemTool({
      name: "memory_consolidate",
      description: "将情景记忆（L2）聚合固化为语义记忆（L3）摘要。需要 AI 生成摘要。",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "命名空间" }
        }
      }
    }, async (args: any) => {
      const summaryIds = await this.store!.consolidate(args.namespace);
      return { status: "success", summaryIds };
    });

    console.log("[Memory] Registered Memory Tools (bionic layers)");
  }
}
