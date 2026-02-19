export enum MemoryLayer {
  L1 = "L1", // Working Memory (Short-term, context)
  L2 = "L2", // Episodic Memory (Medium-term, experiences)
  L3 = "L3", // Long-term Memory (Semantic & Core Episodic)
}

export interface MemoryAttributes {
  importance: number; // 1-10
  sentiment?: number; // -1.0 to 1.0
  confidence?: number; // 0.0 to 1.0
  memoryStrength?: number; // For forgetting curve
}

export interface MemoryEntry {
  id: string;
  namespace?: string; // 命名空间，用于多 Agent 记忆隔离，默认 "default"
  content: string;
  layer: MemoryLayer;
  embedding?: number[];
  attributes?: MemoryAttributes;
  metadata?: Record<string, any>;
  createdAt: number;
  lastAccessed?: number;
  ttl?: number; // Time to live in seconds (for L1)
}

export interface MemoryQuery {
  text: string;
  namespace?: string; // 查询时限定命名空间
  limit?: number;
  threshold?: number;
  filter?: {
    layer?: MemoryLayer[];
    minImportance?: number;
    before?: number; // Time Travel: Only include memories created before this timestamp
    after?: number;
    [key: string]: any;
  };
}

export interface MemoryResult {
  entry: MemoryEntry;
  score: number;
  source: "vector" | "keyword" | "hybrid";
}
