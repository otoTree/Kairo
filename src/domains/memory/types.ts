export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface MemoryQuery {
  text: string;
  limit?: number;
  threshold?: number;
  filter?: Record<string, any>;
}

export interface MemoryResult {
  entry: MemoryEntry;
  score: number;
}
