import { AIPlugin } from "../ai/ai.plugin";
import type { MemoryEntry, MemoryQuery, MemoryResult } from "./types";

export class MemCube {
  private entries: MemoryEntry[] = []; // Temporary in-memory storage for MVP

  constructor(private ai: AIPlugin, private embeddingProviderName?: string) {}

  async add(content: string, metadata?: Record<string, any>): Promise<string> {
    // 1. Generate embedding
    // 2. Store entry
    const embeddingResponse = await this.ai.embed(content, { provider: this.embeddingProviderName });
    
    const id = Math.random().toString(36).substring(7);
    const entry: MemoryEntry = {
      id,
      content,
      embedding: embeddingResponse.embedding,
      metadata,
      createdAt: Date.now(),
    };
    
    this.entries.push(entry);
    console.log(`[MemCube] Added memory: ${id}`);
    return id;
  }

  async recall(query: MemoryQuery): Promise<MemoryResult[]> {
    // 1. Generate query embedding
    // 2. Calculate cosine similarity
    // 3. Return top K results
    
    const queryEmbedding = await this.ai.embed(query.text, { provider: this.embeddingProviderName });
    const vecA = queryEmbedding.embedding;

    const results = this.entries.map(entry => {
      if (!entry.embedding) return { entry, score: -1 };
      const score = this.cosineSimilarity(vecA, entry.embedding);
      return { entry, score };
    });

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Filter by threshold
    const threshold = query.threshold ?? 0.7;
    const filtered = results.filter(r => r.score >= threshold);

    // Limit
    const limit = query.limit ?? 5;
    return filtered.slice(0, limit);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    // Ensure we don't access out of bounds if lengths differ (though they shouldn't)
    const length = Math.min(vecA.length, vecB.length);
    
    for (let i = 0; i < length; i++) {
        const valA = vecA[i] ?? 0;
        const valB = vecB[i] ?? 0;
        dotProduct += valA * valB;
        magnitudeA += valA * valA;
        magnitudeB += valB * valB;
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }
    return dotProduct / (magnitudeA * magnitudeB);
  }
}
