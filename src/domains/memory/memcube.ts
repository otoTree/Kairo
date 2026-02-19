import { AIPlugin } from "../ai/ai.plugin";
import { type MemoryEntry, type MemoryQuery, type MemoryResult, MemoryLayer, type MemoryAttributes } from "./types";
import { open, type RootDatabase } from "lmdb";
import hnswlib from "hnswlib-node";
import MiniSearch from "minisearch";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

export class MemCube {
  private lmdb?: RootDatabase;
  private index?: hnswlib.HierarchicalNSW;
  private miniSearch?: MiniSearch;
  
  private storagePath: string;
  private dimension = 0;
  private currentIntId = 0;
  // 互斥锁：防止并发 add() 导致 ID 冲突
  private addLock: Promise<void> = Promise.resolve();
  
  // Configuration
  private readonly MAX_ELEMENTS = 10000; // HNSW max elements capacity
  private persistTimer: NodeJS.Timeout | null = null;
  private gcTimer: NodeJS.Timer | null = null;
  private consolidateTimer: NodeJS.Timer | null = null;
  private readonly PERSIST_DEBOUNCE_MS = 2000;
  private readonly GC_INTERVAL_MS = 60 * 1000; // Run GC every minute
  private readonly CONSOLIDATE_INTERVAL_MS = 60 * 60 * 1000; // Run Consolidate every hour
  
  constructor(
      private ai: AIPlugin, 
      private embeddingProviderName?: string,
      storagePath?: string
  ) {
      this.storagePath = storagePath || path.join(process.cwd(), "data", "memcube");
  }

  async init() {
      // Ensure directory exists
      if (!existsSync(this.storagePath)) {
          await fs.mkdir(this.storagePath, { recursive: true });
      }

      // 1. Initialize LMDB
      this.lmdb = open({
          path: this.storagePath,
          compression: true,
      });

      // 2. Load Config (Dimension, NextID)
      const config = this.lmdb.get("sys:config") as { dimension: number, nextIntId: number } | undefined;
      if (config) {
          this.dimension = config.dimension;
          this.currentIntId = config.nextIntId;
      } else {
          this.currentIntId = 0;
      }

      // 3. Initialize MiniSearch
      this.miniSearch = new MiniSearch({
          fields: ['content'], // fields to index for full-text search
          storeFields: ['id'], // only need id
          idField: 'id'
      });
      
      const miniSearchPath = path.join(this.storagePath, "search.json");
      if (existsSync(miniSearchPath)) {
          const json = await fs.readFile(miniSearchPath, "utf-8");
          this.miniSearch = MiniSearch.loadJSON(json, {
             fields: ['content'],
             storeFields: ['id'],
             idField: 'id' 
          });
      }

      // 4. Initialize HNSW (Lazy load if dimension is unknown, otherwise load)
      if (this.dimension > 0) {
          await this.loadHNSW();
      }
      
      this.startBackgroundTasks();
      
      console.log(`[MemCube] Initialized at ${this.storagePath}. Dimension: ${this.dimension}, Items: ${this.currentIntId}`);
  }

  private async loadHNSW() {
      const indexPath = path.join(this.storagePath, "vector.index");
      this.index = new hnswlib.HierarchicalNSW("cosine", this.dimension);
      
      if (existsSync(indexPath)) {
          try {
              this.index.readIndexSync(indexPath);
          } catch (e) {
              console.error("[MemCube] Failed to load vector index, rebuilding is not supported yet without raw vectors.", e);
              this.index.initIndex(this.MAX_ELEMENTS);
          }
      } else {
          this.index.initIndex(this.MAX_ELEMENTS);
      }
  }

  async add(content: string, options?: {
      namespace?: string; // 命名空间，默认 "default"
      layer?: MemoryLayer;
      attributes?: MemoryAttributes;
      metadata?: Record<string, any>;
      ttl?: number;
  }): Promise<string> {
    // 使用 Promise 链作为互斥锁，确保 ID 分配的原子性
    return new Promise<string>((resolve, reject) => {
      this.addLock = this.addLock.then(async () => {
        try {
          resolve(await this._addInternal(content, options));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  private async _addInternal(content: string, options?: {
      namespace?: string;
      layer?: MemoryLayer;
      attributes?: MemoryAttributes;
      metadata?: Record<string, any>;
      ttl?: number;
  }): Promise<string> {
    if (!this.lmdb) await this.init();

    const ns = options?.namespace || "default";

    // 1. Generate embedding
    const embeddingResponse = await this.ai.embed(content, { provider: this.embeddingProviderName });
    const vector = embeddingResponse.embedding;

    // 2. Check/Set Dimension
    if (this.dimension === 0) {
        this.dimension = vector.length;
        await this.loadHNSW(); // Init HNSW for the first time
        await this.saveConfig();
    } else if (vector.length !== this.dimension) {
        throw new Error(`Embedding dimension mismatch. Expected ${this.dimension}, got ${vector.length}`);
    }

    // 3. IDs — 使用复合键 {namespace}:{id}
    const id = Math.random().toString(36).substring(7);
    const compositeKey = `${ns}:${id}`;
    const intId = this.currentIntId++;

    // Determine TTL
    let ttl = options?.ttl;
    if (!ttl && options?.layer === MemoryLayer.L1) {
        ttl = 3600; // Default 1 hour for L1
    }

    const layer = options?.layer || MemoryLayer.L2;
    const entry: MemoryEntry = {
      id,
      namespace: ns,
      content,
      layer,
      embedding: vector,
      attributes: options?.attributes,
      metadata: options?.metadata,
      createdAt: Date.now(),
      ttl,
      lastAccessed: Date.now()
    };

    // 4. Write to Stores
    // LMDB — 使用复合键存储
    await this.lmdb!.put(compositeKey, entry);
    await this.lmdb!.put(`map:int:${intId}`, compositeKey); // Int -> compositeKey
    await this.lmdb!.put(`map:uuid:${compositeKey}`, intId); // compositeKey -> Int
    // 二级索引：按 layer 分类，GC 时避免全表扫描
    await this.lmdb!.put(`idx:layer:${layer}:${compositeKey}`, true);
    await this.saveConfig(); // Update nextIntId

    // HNSW
    // Resize if needed
    if (this.index!.getCurrentCount() >= this.index!.getMaxElements()) {
        this.index!.resizeIndex(this.index!.getMaxElements() * 2);
    }
    this.index!.addPoint(vector, intId);

    // MiniSearch — 使用 compositeKey 作为 id
    this.miniSearch!.add({ id: compositeKey, content });

    // 5. Persist Indexes (Async)
    this.schedulePersistence();

    console.log(`[MemCube] Added memory: ${compositeKey} (intId: ${intId}, layer: ${layer})`);
    return id;
  }

  async memorize(content: string): Promise<void> {
      await this.add(content);
  }

  // 强化记忆：更新重要性和记忆强度
  async reinforce(id: string, feedback: "positive" | "negative" | "access", namespace?: string): Promise<void> {
      if (!this.lmdb) return;

      const compositeKey = `${namespace || "default"}:${id}`;
      const entry = this.lmdb.get(compositeKey) as MemoryEntry;
      if (!entry) return;

      entry.attributes = entry.attributes || { importance: 5, memoryStrength: 1 };
      
      // Update Access Time
      const now = Date.now();
      entry.lastAccessed = now;

      if (feedback === "positive") {
          entry.attributes.importance = Math.min(10, (entry.attributes.importance || 5) + 1);
          entry.attributes.memoryStrength = (entry.attributes.memoryStrength || 1) + 0.5;
      } else if (feedback === "negative") {
          entry.attributes.importance = Math.max(0, (entry.attributes.importance || 5) - 1);
          entry.attributes.memoryStrength = Math.max(0.1, (entry.attributes.memoryStrength || 1) - 0.5);
      } else if (feedback === "access") {
           // Just accessing it reinforces it slightly
           entry.attributes.memoryStrength = (entry.attributes.memoryStrength || 1) + 0.1;
      }
      
      await this.lmdb.put(compositeKey, entry);
      // No need to rebuild vector index as vector didn't change, but attributes did.
      // Ideally we might want to update some metadata index if we had one.
  }

  async recall(query: string): Promise<string[]>;
  async recall(query: MemoryQuery): Promise<MemoryResult[]>;
  async recall(query: MemoryQuery | string): Promise<MemoryResult[] | string[]> {
    if (!this.lmdb) await this.init();
    
    const text = typeof query === 'string' ? query : query.text;
    const limit = typeof query === 'object' && query.limit ? query.limit : 5;
    const threshold = typeof query === 'object' && query.threshold ? query.threshold : 0.0;
    const filter = typeof query === 'object' ? query.filter : undefined;
    const namespace = typeof query === 'object' ? query.namespace : undefined;
    
    // RRF Constants
    const k = 60;
    const candidates = new Map<string, { 
        id: string; 
        rrfScore: number; 
        vectorScore?: number; 
        keywordScore?: number;
        sources: Set<"vector" | "keyword"> 
    }>();

    const addToCandidates = (id: string, source: "vector" | "keyword", rank: number, rawScore: number) => {
        if (!candidates.has(id)) {
            candidates.set(id, { id, rrfScore: 0, sources: new Set() });
        }
        const cand = candidates.get(id)!;
        cand.sources.add(source);
        cand.rrfScore += 1 / (k + rank);
        
        if (source === "vector") cand.vectorScore = rawScore;
        if (source === "keyword") cand.keywordScore = rawScore;
    };

    // 1. Vector Search
    if (this.index && this.dimension > 0) {
        try {
            const queryEmbedding = await this.ai.embed(text, { provider: this.embeddingProviderName });
            // Search more than limit to allow for RRF intersection
            const searchK = limit * 2; 
            const result = this.index.searchKnn(queryEmbedding.embedding, searchK);
            
            const neighbors = result.neighbors;
            const distances = result.distances;

            for (let i = 0; i < neighbors.length; i++) {
                const intId = neighbors[i];
                const distance = distances[i] ?? 1;
                const similarity = 1 - distance;
                
                // Retrieve compositeKey
                const compositeKey = this.lmdb!.get(`map:int:${intId}`) as string;
                if (compositeKey) {
                    addToCandidates(compositeKey, "vector", i + 1, similarity);
                }
            }
        } catch (e) {
            console.warn("[MemCube] Vector search failed", e);
        }
    }

    // 2. Keyword Search
    if (this.miniSearch) {
        // Search more than limit
        const allResults = this.miniSearch.search(text);
        const results = allResults.slice(0, limit * 2);

        for (let i = 0; i < results.length; i++) {
            const res = results[i];
            if (res) {
                addToCandidates(res.id, "keyword", i + 1, res.score);
            }
        }
    }

    // 3. Filter and Sort
    let results: MemoryResult[] = [];
    
    for (const cand of candidates.values()) {
        const entry = this.lmdb!.get(cand.id) as MemoryEntry;
        if (!entry) continue;

        // 命名空间过滤
        if (namespace && entry.namespace && entry.namespace !== namespace) continue;

        // Apply Filters
        if (filter) {
            if (filter.layer && !filter.layer.includes(entry.layer)) continue;
            if (filter.minImportance && (entry.attributes?.importance ?? 0) < filter.minImportance) continue;
            // Time Travel Filters
            if (filter.before && entry.createdAt >= filter.before) continue;
            if (filter.after && entry.createdAt <= filter.after) continue;
        }
        
        // Threshold check (Only apply to vector score if it exists, or skip if strict)
        // If threshold is set and high (e.g. 0.7), it implies semantic similarity.
        // If vectorScore is present but < threshold, we might want to drop it unless keyword match is strong?
        // For now, if threshold > 0, we require vectorScore >= threshold OR (no vector score AND threshold is low).
        // Let's keep it simple: if vector score exists, check threshold.
        if (cand.vectorScore !== undefined && cand.vectorScore < threshold) continue;

        results.push({
            entry,
            score: cand.vectorScore ?? 0, // Expose Vector Similarity as primary score
            source: cand.sources.size > 1 ? "hybrid" : (cand.sources.has("vector") ? "vector" : "keyword")
        });
    }

    // Sort by RRF Score (implicit in the order we want? No, we need to sort results by RRF score from candidates)
    // We need to map back to RRF score for sorting
    results.sort((a, b) => {
        const scoreA = candidates.get(a.entry.id)!.rrfScore;
        const scoreB = candidates.get(b.entry.id)!.rrfScore;
        return scoreB - scoreA;
    });

    results = results.slice(0, limit);

    if (typeof query === 'string') {
        return results.map(r => r.entry.content);
    }
    return results;
  }

  private async saveConfig() {
      await this.lmdb!.put("sys:config", {
          dimension: this.dimension,
          nextIntId: this.currentIntId
      });
  }

  private schedulePersistence() {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => {
          this.persistIndexes().catch(err => console.error("[MemCube] Async persist failed", err));
          this.persistTimer = null;
      }, this.PERSIST_DEBOUNCE_MS);
  }

  private async persistIndexes() {
      if (this.index) {
          const indexPath = path.join(this.storagePath, "vector.index");
          this.index.writeIndexSync(indexPath);
      }
      if (this.miniSearch) {
          const searchPath = path.join(this.storagePath, "search.json");
          await fs.writeFile(searchPath, JSON.stringify(this.miniSearch.toJSON()));
      }
  }
  
  private startBackgroundTasks() {
      if (this.gcTimer) clearInterval(this.gcTimer);
      this.gcTimer = setInterval(() => {
          this.runGC().catch(e => console.error("[MemCube] GC failed", e));
      }, this.GC_INTERVAL_MS);

      if (this.consolidateTimer) clearInterval(this.consolidateTimer);
      this.consolidateTimer = setInterval(() => {
          // Consolidate memories (batch size 20)
          this.consolidate({ batchSize: 20 }).catch(e => console.error("[MemCube] Auto-Consolidate failed", e));
      }, this.CONSOLIDATE_INTERVAL_MS);
  }

  private stopBackgroundTasks() {
      if (this.gcTimer) {
          clearInterval(this.gcTimer);
          this.gcTimer = null;
      }
      if (this.consolidateTimer) {
          clearInterval(this.consolidateTimer);
          this.consolidateTimer = null;
      }
      if (this.persistTimer) {
          clearTimeout(this.persistTimer);
          // Force persist on stop
          this.persistIndexes();
      }
  }

  // 垃圾回收：使用二级索引按 layer 扫描，避免全表扫描
  private async runGC() {
      if (!this.lmdb) return;

      const now = Date.now();
      let deleteCount = 0;
      let promoteCount = 0;

      // 1. L1 TTL 清理：只扫描 L1 索引
      for (const { key } of this.lmdb.getRange({ start: 'idx:layer:L1:', end: 'idx:layer:L1:\xff' })) {
          const compositeKey = (key as string).slice('idx:layer:L1:'.length);
          const entry = this.lmdb.get(compositeKey) as MemoryEntry;
          if (!entry) { await this.lmdb.remove(key); continue; }

          if (entry.ttl) {
              const expireAt = entry.createdAt + (entry.ttl * 1000);
              if (now > expireAt) {
                  await this.deleteMemory(compositeKey, entry);
                  await this.lmdb.remove(key);
                  deleteCount++;
              }
          }
      }

      // 2. L2 遗忘曲线 + 晋升
      for (const { key } of this.lmdb.getRange({ start: 'idx:layer:L2:', end: 'idx:layer:L2:\xff' })) {
          const compositeKey = (key as string).slice('idx:layer:L2:'.length);
          const entry = this.lmdb.get(compositeKey) as MemoryEntry;
          if (!entry) { await this.lmdb.remove(key); continue; }

          // R = e^(-t/S)
          const t = (now - (entry.lastAccessed || entry.createdAt)) / (1000 * 3600 * 24);
          const S = entry.attributes?.memoryStrength || 1.0;
          const R = Math.exp(-t / S);

          if (R < 0.1) {
              await this.deleteMemory(compositeKey, entry);
              await this.lmdb.remove(key);
              deleteCount++;
              continue;
          }

          // L2 → L3 晋升（闪光灯记忆）
          const importance = entry.attributes?.importance || 0;
          const sentiment = Math.abs(entry.attributes?.sentiment || 0);

          if (importance > 8 && sentiment > 0.8) {
              entry.layer = MemoryLayer.L3;
              entry.attributes = { ...entry.attributes, importance, flashbulb: true } as any;
              await this.lmdb.put(compositeKey, entry);
              // 更新索引：删除 L2 索引，添加 L3 索引
              await this.lmdb.remove(key);
              await this.lmdb.put(`idx:layer:L3:${compositeKey}`, true);
              promoteCount++;
              console.log(`[MemCube] Promoted memory ${compositeKey} to L3 (Flashbulb)`);
          }
      }

      if (deleteCount > 0 || promoteCount > 0) {
          console.log(`[MemCube] GC Completed. Deleted: ${deleteCount}, Promoted: ${promoteCount}`);
          this.schedulePersistence();
      }
  }

  private async deleteMemory(compositeKey: string, entry: MemoryEntry) {
      if (!this.lmdb) return;

      // 从 LMDB 删除主记录
      await this.lmdb.remove(compositeKey);

      // 从 MiniSearch 删除（使用 compositeKey 作为 id）
      if (this.miniSearch) {
          try { this.miniSearch.remove({ id: compositeKey }); } catch (e) { /* 忽略 */ }
      }

      // 从 HNSW 删除
      const intId = this.lmdb.get(`map:uuid:${compositeKey}`) as number | undefined;
      if (intId !== undefined && this.index) {
          try {
             this.index.markDelete(intId);
          } catch (e) {
             console.warn(`[MemCube] Failed to markDelete in HNSW for ${compositeKey} (intId: ${intId})`, e);
          }
      }

      // 清理映射和索引
      if (intId !== undefined) {
          await this.lmdb.remove(`map:int:${intId}`);
          await this.lmdb.remove(`map:uuid:${compositeKey}`);
      }
      // 清理 layer 索引
      await this.lmdb.remove(`idx:layer:${entry.layer}:${compositeKey}`);
  }

  // 合并 L2 记忆为 L3 摘要
  async consolidate(options?: { batchSize?: number }): Promise<string[]> {
      if (!this.lmdb) await this.init();

      const batchSize = options?.batchSize || 10;
      const candidates: MemoryEntry[] = [];

      // 使用 L2 索引扫描，避免全表扫描
      for (const { key } of this.lmdb!.getRange({ start: 'idx:layer:L2:', end: 'idx:layer:L2:\xff' })) {
          const compositeKey = (key as string).slice('idx:layer:L2:'.length);
          const entry = this.lmdb!.get(compositeKey) as MemoryEntry;
          if (!entry) { await this.lmdb!.remove(key); continue; }

          if ((entry.attributes?.importance || 0) > 3) {
              candidates.push({ ...entry, id: compositeKey } as any);
              if (candidates.length >= batchSize) break;
          }
      }

      if (candidates.length === 0) return [];

      // Generate Summary
      const prompt = `Summarize the following ${candidates.length} memories into a single, concise knowledge entry. Focus on facts and user preferences.\n\nMemories:\n${candidates.map(c => `- ${c.content}`).join('\n')}`;
      
      try {
          // Use AIPlugin.chat to generate summary
          const response = await this.ai.chat(
              [{ role: "user", content: prompt }], 
              { provider: this.embeddingProviderName } // Use same provider or default
          );
          
          const summary = response.content;
          if (!summary) return [];

          // Add Summary as L3
          const summaryId = await this.add(summary, {
              layer: MemoryLayer.L3,
              attributes: { importance: 8, confidence: 0.9 }, // High confidence summary
              metadata: { type: "consolidation_summary", source_count: candidates.length }
          });
          
          // Cleanup consolidated memories?
          // Spec says "Event Aggregation", implies original trivial events might be less useful.
          // For now, let's just mark them as consolidated or delete if low importance.
          // Let's delete them to save space and reduce noise, as per "Summarize 100 trivial interactions into 1"
          for (const cand of candidates) {
              await this.deleteMemory(cand.id, cand);
          }
          
          return [summaryId];
      } catch (e) {
          console.error("[MemCube] Consolidation failed", e);
          return [];
      }
  }

  /**
   * 跨命名空间共享记忆
   */
  async share(fromNamespace: string, toNamespace: string, memoryId: string): Promise<string> {
      if (!this.lmdb) await this.init();
      const sourceKey = `${fromNamespace}:${memoryId}`;
      const entry = this.lmdb!.get(sourceKey) as MemoryEntry;
      if (!entry) throw new Error(`记忆 ${sourceKey} 不存在`);

      return this.add(entry.content, {
          namespace: toNamespace,
          layer: entry.layer,
          attributes: entry.attributes,
          metadata: { ...entry.metadata, sharedFrom: fromNamespace, originalId: memoryId },
          ttl: entry.ttl,
      });
  }

  /**
   * 导出指定命名空间的记忆为 JSON
   */
  async exportMemories(namespace?: string): Promise<string> {
      if (!this.lmdb) await this.init();
      const entries: Omit<MemoryEntry, 'embedding'>[] = [];

      for (const { key, value } of this.lmdb!.getRange({})) {
          if (typeof key !== 'string') continue;
          if (key.startsWith('sys:') || key.startsWith('map:') || key.startsWith('idx:')) continue;

          const entry = value as MemoryEntry;
          if (namespace && entry.namespace !== namespace) continue;

          // 导出时不含 embedding（太大），导入时重新生成
          const { embedding, ...rest } = entry;
          entries.push(rest);
      }

      return JSON.stringify({ version: 1, exportedAt: Date.now(), count: entries.length, entries });
  }

  /**
   * 导入记忆
   */
  async importMemories(data: string): Promise<number> {
      const parsed = JSON.parse(data);
      if (!parsed.entries || !Array.isArray(parsed.entries)) {
          throw new Error('无效的导入数据格式');
      }
      let count = 0;
      for (const entry of parsed.entries) {
          await this.add(entry.content, {
              namespace: entry.namespace,
              layer: entry.layer,
              attributes: entry.attributes,
              metadata: entry.metadata,
              ttl: entry.ttl,
          });
          count++;
      }
      return count;
  }

  async close() {
      this.stopBackgroundTasks();
      await this.lmdb?.close();
  }
}
