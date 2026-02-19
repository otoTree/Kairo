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
      layer?: MemoryLayer;
      attributes?: MemoryAttributes;
      metadata?: Record<string, any>;
      ttl?: number;
  }): Promise<string> {
    if (!this.lmdb) await this.init();

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

    // 3. IDs
    const id = Math.random().toString(36).substring(7); // UUID
    const intId = this.currentIntId++;
    
    // Determine TTL
    let ttl = options?.ttl;
    if (!ttl && options?.layer === MemoryLayer.L1) {
        ttl = 3600; // Default 1 hour for L1
    }

    const entry: MemoryEntry = {
      id,
      content,
      layer: options?.layer || MemoryLayer.L2, // Default to L2
      embedding: vector, 
      attributes: options?.attributes,
      metadata: options?.metadata,
      createdAt: Date.now(),
      ttl,
      lastAccessed: Date.now()
    };
    
    // 4. Write to Stores
    // LMDB
    await this.lmdb!.put(id, entry);
    await this.lmdb!.put(`map:int:${intId}`, id); // Int -> UUID
    await this.lmdb!.put(`map:uuid:${id}`, intId); // UUID -> Int (For deletion)
    await this.saveConfig(); // Update nextIntId

    // HNSW
    // Resize if needed
    if (this.index!.getCurrentCount() >= this.index!.getMaxElements()) {
        this.index!.resizeIndex(this.index!.getMaxElements() * 2);
    }
    this.index!.addPoint(vector, intId);
    
    // MiniSearch
    this.miniSearch!.add({ id, content });

    // 5. Persist Indexes (Async)
    this.schedulePersistence();

    console.log(`[MemCube] Added memory: ${id} (intId: ${intId}, layer: ${entry.layer})`);
    return id;
  }

  async memorize(content: string): Promise<void> {
      await this.add(content);
  }

  // Reinforce memory: Update importance and memory strength
  async reinforce(id: string, feedback: "positive" | "negative" | "access"): Promise<void> {
      if (!this.lmdb) return;
      
      const entry = this.lmdb.get(id) as MemoryEntry;
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
      
      await this.lmdb.put(id, entry);
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
                
                // Retrieve UUID
                const uuid = this.lmdb!.get(`map:int:${intId}`) as string;
                if (uuid) {
                    addToCandidates(uuid, "vector", i + 1, similarity);
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

  // Garbage Collection & Consolidation
  private async runGC() {
      if (!this.lmdb) return;
      
      const now = Date.now();
      let deleteCount = 0;
      let promoteCount = 0;

      // Iterate all entries (this is expensive for large DBs, but okay for local MVP)
      // LMDB supports iteration.
      for (const { key, value } of this.lmdb.getRange({})) {
          if (typeof key !== 'string' || key.startsWith('sys:') || key.startsWith('map:')) continue;
          
          const entry = value as MemoryEntry;
          
          // 1. L1 TTL Cleanup
          if (entry.layer === MemoryLayer.L1 && entry.ttl) {
              const expireAt = entry.createdAt + (entry.ttl * 1000);
              if (now > expireAt) {
                  await this.deleteMemory(key, entry);
                  deleteCount++;
                  continue;
              }
          }

          // 2. L2 Forgetting Curve
          if (entry.layer === MemoryLayer.L2) {
              // R = e^(-t/S)
              const t = (now - (entry.lastAccessed || entry.createdAt)) / (1000 * 3600 * 24); // Time in days
              const S = entry.attributes?.memoryStrength || 1.0;
              const R = Math.exp(-t / S);

              // If retention < 0.1, forget it
              if (R < 0.1) {
                   await this.deleteMemory(key, entry);
                   deleteCount++;
                   continue;
              }

              // 3. L2 -> L3 Promotion (Flashbulb Memory)
              // If importance > 8 and Sentiment is strong (abs > 0.8) and not already L3
              // Note: We don't move it, we copy it to L3 (or just change layer? Spec says copy/promote)
              // Let's just change the layer to L3 to keep it simple and persistent.
              const importance = entry.attributes?.importance || 0;
              const sentiment = Math.abs(entry.attributes?.sentiment || 0);
              
              if (importance > 8 && sentiment > 0.8) {
                  entry.layer = MemoryLayer.L3;
                  entry.attributes = { ...entry.attributes, importance, flashbulb: true } as any;
                  await this.lmdb.put(key, entry);
                  promoteCount++;
                  console.log(`[MemCube] Promoted memory ${key} to L3 (Flashbulb)`);
              }
          }
      }

      if (deleteCount > 0 || promoteCount > 0) {
          console.log(`[MemCube] GC Completed. Deleted: ${deleteCount}, Promoted: ${promoteCount}`);
          // Trigger persist if we modified structure (miniSearch/HNSW removed in deleteMemory)
          this.schedulePersistence(); 
      }
  }

  private async deleteMemory(id: string, entry: MemoryEntry) {
      if (!this.lmdb) return;
      
      // Remove from LMDB
      await this.lmdb.remove(id);
      
      // Remove from MiniSearch
      if (this.miniSearch) {
          this.miniSearch.remove({ id });
      }

      // Remove from HNSW
      const intId = this.lmdb.get(`map:uuid:${id}`) as number | undefined;
      if (intId !== undefined && this.index) {
          try {
             // hnswlib-node markDelete: Marks the element as deleted
             this.index.markDelete(intId);
          } catch (e) {
             console.warn(`[MemCube] Failed to markDelete in HNSW for ${id} (intId: ${intId})`, e);
          }
      }
      
      // Cleanup Maps
      if (intId !== undefined) {
          await this.lmdb.remove(`map:int:${intId}`);
          await this.lmdb.remove(`map:uuid:${id}`);
      }
  }

  // Consolidate L2 memories into L3 summaries
  async consolidate(options?: { batchSize?: number }): Promise<string[]> {
      if (!this.lmdb) await this.init();
      
      const batchSize = options?.batchSize || 10;
      const candidates: MemoryEntry[] = [];

      // Scan L2 memories that haven't been consolidated recently (e.g. importance > 3)
      // This is a naive scan. In production, we'd use an index or specific queue.
      for (const { key, value } of this.lmdb!.getRange({})) {
          if (typeof key !== 'string' || key.startsWith('sys:') || key.startsWith('map:')) continue;
          const entry = value as MemoryEntry;
          
          if (entry.layer === MemoryLayer.L2 && (entry.attributes?.importance || 0) > 3) {
              candidates.push(entry);
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

  async close() {
      this.stopBackgroundTasks();
      await this.lmdb?.close();
  }
}
