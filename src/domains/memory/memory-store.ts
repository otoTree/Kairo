import { MemoryLayer, type MemoryEntry, type MemoryQuery, type MemoryResult } from "./types";
import type { LongTermMemory } from "../agent/memory";
import type { AIPlugin } from "../ai/ai.plugin";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// 层级 → 文件名映射
const LAYER_FILES: Record<MemoryLayer, string> = {
  [MemoryLayer.Working]: "working.md",
  [MemoryLayer.Episodic]: "episodic.md",
  [MemoryLayer.Semantic]: "semantic.md",
  [MemoryLayer.Flashbulb]: "flashbulb.md",
};

// 层级 → 标题映射
const LAYER_TITLES: Record<MemoryLayer, string> = {
  [MemoryLayer.Working]: "Working Memory (工作记忆)",
  [MemoryLayer.Episodic]: "Episodic Memory (情景记忆)",
  [MemoryLayer.Semantic]: "Semantic Memory (语义记忆)",
  [MemoryLayer.Flashbulb]: "Flashbulb Memory (闪光灯记忆)",
};

// L1 工作记忆容量上限
const WORKING_MEMORY_LIMIT = 50;

/**
 * 仿生 Markdown 记忆存储
 *
 * 保留三层记忆模型（工作/情景/长期），以纯 Markdown 文件实现。
 * 实现 LongTermMemory 接口，可注入 AgentMemory。
 */
export class MemoryStore implements LongTermMemory {
  private basePath: string;
  private ai?: AIPlugin;

  constructor(storagePath?: string, ai?: AIPlugin) {
    this.basePath = storagePath || path.join(process.cwd(), "data", "memory");
    this.ai = ai;
  }

  async init(): Promise<void> {
    if (!existsSync(this.basePath)) {
      await fs.mkdir(this.basePath, { recursive: true });
    }
  }

  // ─── 核心 API ───

  /**
   * 添加记忆
   * importance ≥ 8 时自动晋升为闪光灯记忆
   */
  async add(content: string, options?: {
    namespace?: string;
    layer?: MemoryLayer;
    importance?: number;
    tags?: string[];
  }): Promise<string> {
    const ns = options?.namespace || "default";
    const importance = options?.importance ?? 5;
    const tags = options?.tags || [];
    const id = Math.random().toString(36).substring(2, 10);
    const now = Date.now();

    // 闪光灯晋升：importance ≥ 8 自动存入 flashbulb
    let layer = options?.layer || MemoryLayer.Episodic;
    if (importance >= 8 && layer === MemoryLayer.Episodic) {
      layer = MemoryLayer.Flashbulb;
    }

    const entry: MemoryEntry = { id, layer, content, importance, tags, createdAt: now };

    // 确保命名空间目录存在
    const nsDir = path.join(this.basePath, ns);
    if (!existsSync(nsDir)) {
      await fs.mkdir(nsDir, { recursive: true });
    }

    // 追加到对应层级文件
    const filePath = path.join(nsDir, LAYER_FILES[layer]);
    const block = this.serializeEntry(entry);

    if (!existsSync(filePath)) {
      await fs.writeFile(filePath, `# ${LAYER_TITLES[layer]}\n\n${block}`, "utf-8");
    } else {
      await fs.appendFile(filePath, block, "utf-8");
    }

    // L1 工作记忆容量控制
    if (layer === MemoryLayer.Working) {
      await this.trimWorkingMemory(nsDir);
    }

    return id;
  }

  /**
   * 关键词搜索记忆（跨层级）
   * 得分 = 关键词匹配率 × (1 + importance/10)
   */
  async recall(query: string): Promise<string[]>;
  async recall(query: MemoryQuery, namespace?: string): Promise<MemoryResult[]>;
  async recall(query: MemoryQuery | string, namespace?: string): Promise<MemoryResult[] | string[]> {
    const isStringQuery = typeof query === "string";
    const text = isStringQuery ? query : query.text;
    const layerFilter = isStringQuery ? undefined : query.layer;
    const filterTags = isStringQuery ? undefined : query.tags;
    const minImportance = isStringQuery ? undefined : query.minImportance;
    const limit = isStringQuery ? 10 : (query.limit || 10);
    const ns = namespace || "default";

    const nsDir = path.join(this.basePath, ns);
    if (!existsSync(nsDir)) return [];

    const layers = layerFilter ? [layerFilter] : Object.values(MemoryLayer);
    const results: MemoryResult[] = [];

    for (const layer of layers) {
      const filePath = path.join(nsDir, LAYER_FILES[layer]);
      if (!existsSync(filePath)) continue;

      const entries = await this.parseFile(filePath, layer);
      for (const entry of entries) {
        if (filterTags?.length && !filterTags.some(t => entry.tags.includes(t))) continue;
        if (minImportance && entry.importance < minImportance) continue;

        const keywordScore = this.computeKeywordScore(entry.content, text, entry.tags);
        if (keywordScore > 0) {
          // importance 加权：重要记忆排名更高
          const score = keywordScore * (1 + entry.importance / 10);
          results.push({ entry, score });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    const sliced = results.slice(0, limit);

    if (isStringQuery) {
      return sliced.map(r => r.entry.content);
    }
    return sliced;
  }

  /**
   * 删除记忆
   */
  async forget(id: string, namespace?: string): Promise<boolean> {
    const ns = namespace || "default";
    const nsDir = path.join(this.basePath, ns);
    if (!existsSync(nsDir)) return false;

    for (const layer of Object.values(MemoryLayer)) {
      const filePath = path.join(nsDir, LAYER_FILES[layer]);
      if (!existsSync(filePath)) continue;

      const raw = await fs.readFile(filePath, "utf-8");
      const blocks = raw.split("\n---\n");
      const filtered = blocks.filter(b => !b.includes(`id:${id}`));
      if (filtered.length < blocks.length) {
        await fs.writeFile(filePath, filtered.join("\n---\n"), "utf-8");
        return true;
      }
    }
    return false;
  }

  /**
   * 列出记忆
   */
  async list(namespace?: string, layer?: MemoryLayer): Promise<MemoryEntry[]> {
    const ns = namespace || "default";
    const nsDir = path.join(this.basePath, ns);
    if (!existsSync(nsDir)) return [];

    const layers = layer ? [layer] : Object.values(MemoryLayer);
    const entries: MemoryEntry[] = [];

    for (const l of layers) {
      const filePath = path.join(nsDir, LAYER_FILES[l]);
      if (!existsSync(filePath)) continue;
      entries.push(...await this.parseFile(filePath, l));
    }

    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 固化：将 L2 情景记忆聚合为 L3 语义摘要
   * 需要 AIPlugin 生成摘要
   */
  async consolidate(namespace?: string): Promise<string[]> {
    if (!this.ai) {
      console.warn("[MemoryStore] consolidate 需要 AIPlugin，跳过");
      return [];
    }

    const ns = namespace || "default";
    const nsDir = path.join(this.basePath, ns);
    const episodicPath = path.join(nsDir, LAYER_FILES[MemoryLayer.Episodic]);
    if (!existsSync(episodicPath)) return [];

    const episodes = await this.parseFile(episodicPath, MemoryLayer.Episodic);
    // 只固化 importance > 3 的情景记忆
    const candidates = episodes.filter(e => e.importance > 3);
    if (candidates.length === 0) return [];

    const prompt = `你是一个记忆管理器。请将以下 ${candidates.length} 条情景记忆聚合为简洁的语义知识条目。
提取关键事实、用户偏好和规律，丢弃琐碎细节。

情景记忆：
${candidates.map(c => `- [importance:${c.importance}] ${c.content}`).join("\n")}

请输出聚合后的知识条目（每条一行，用 - 开头）：`;

    try {
      const response = await this.ai.chat([{ role: "user", content: prompt }]);
      const summary = response.content;
      if (!summary) return [];

      // 将摘要存入 L3 语义记忆
      const summaryId = await this.add(summary, {
        namespace: ns,
        layer: MemoryLayer.Semantic,
        importance: 7,
        tags: ["consolidation"],
      });

      // 删除已固化的 L2 条目
      for (const c of candidates) {
        await this.forget(c.id, ns);
      }

      return [summaryId];
    } catch (e) {
      console.error("[MemoryStore] consolidate 失败", e);
      return [];
    }
  }

  // ─── LongTermMemory 接口 ───

  async memorize(content: string): Promise<void> {
    await this.add(content);
  }

  async close(): Promise<void> {
    // 纯文件操作，无需清理
  }

  // ─── 内部方法 ───

  /**
   * L1 工作记忆容量控制：超出上限时删除最旧条目
   */
  private async trimWorkingMemory(nsDir: string): Promise<void> {
    const filePath = path.join(nsDir, LAYER_FILES[MemoryLayer.Working]);
    if (!existsSync(filePath)) return;

    const entries = await this.parseFile(filePath, MemoryLayer.Working);
    if (entries.length <= WORKING_MEMORY_LIMIT) return;

    // 按时间排序，保留最新的
    entries.sort((a, b) => b.createdAt - a.createdAt);
    const kept = entries.slice(0, WORKING_MEMORY_LIMIT);

    // 重写文件
    const header = `# ${LAYER_TITLES[MemoryLayer.Working]}\n\n`;
    const body = kept.map(e => this.serializeEntry(e)).join("");
    await fs.writeFile(filePath, header + body, "utf-8");
  }

  private serializeEntry(entry: MemoryEntry): string {
    const tagStr = entry.tags.length > 0 ? ` | tags:${entry.tags.join(",")}` : "";
    const meta = `id:${entry.id} | created:${entry.createdAt} | importance:${entry.importance}${tagStr}`;
    return `---\n<!-- ${meta} -->\n${entry.content}\n`;
  }

  private async parseFile(filePath: string, layer: MemoryLayer): Promise<MemoryEntry[]> {
    const raw = await fs.readFile(filePath, "utf-8");
    const entries: MemoryEntry[] = [];

    const blocks = raw.split("\n---\n");
    for (const block of blocks) {
      const metaMatch = block.match(/<!--\s*(.+?)\s*-->/);
      if (!metaMatch?.[1]) continue;

      const metaStr = metaMatch[1];
      const id = metaStr.match(/id:(\S+)/)?.[1]?.replace(/\s*\|.*/, "") || "";
      const created = Number(metaStr.match(/created:(\d+)/)?.[1] || 0);
      const importance = Number(metaStr.match(/importance:(\d+)/)?.[1] || 5);
      const tagsRaw = metaStr.match(/tags:([^\s|]+)/)?.[1] || "";
      const tags = tagsRaw ? tagsRaw.split(",") : [];

      const content = block.replace(/<!--.*?-->\n?/, "").trim();
      if (!id || !content) continue;

      entries.push({ id, layer, content, importance, tags, createdAt: created });
    }

    return entries;
  }

  /**
   * 关键词匹配评分
   */
  private computeKeywordScore(content: string, query: string, tags: string[]): number {
    const searchable = `${content.toLowerCase()} ${tags.map(t => t.toLowerCase()).join(" ")}`;
    const tokens = query.toLowerCase().split(/[\s,，。.!?！？、]+/).filter(Boolean);
    if (tokens.length === 0) return 0;

    let matched = 0;
    for (const token of tokens) {
      if (searchable.includes(token)) matched++;
    }
    return matched / tokens.length;
  }
}
