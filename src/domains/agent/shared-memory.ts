export interface SharedMemory {
  getFacts(query?: string): Promise<string[]>;
  addFact(fact: string): Promise<void>;
}

export class InMemorySharedMemory implements SharedMemory {
  private facts: string[] = [];

  async getFacts(query?: string): Promise<string[]> {
    // In a real system, this would use semantic search.
    // For now, return all facts or simple filter.
    if (!query) return this.facts;
    return this.facts.filter(f => f.toLowerCase().includes(query.toLowerCase()));
  }

  async addFact(fact: string): Promise<void> {
    if (!this.facts.includes(fact)) {
      this.facts.push(fact);
    }
  }
}
