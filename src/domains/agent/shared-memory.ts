export interface SharedMemory {
  getFacts(query?: string, namespace?: string): Promise<string[]>;
  addFact(fact: string, namespace?: string): Promise<void>;
}

export class InMemorySharedMemory implements SharedMemory {
  // 按命名空间存储 facts
  private namespacedFacts = new Map<string, string[]>();

  async getFacts(query?: string, namespace: string = "global"): Promise<string[]> {
    const nsFacts = this.namespacedFacts.get(namespace) || [];
    // 同时包含 global 命名空间的 facts
    const globalFacts = namespace !== "global" ? (this.namespacedFacts.get("global") || []) : [];
    const allFacts = [...nsFacts, ...globalFacts];

    if (!query) return allFacts;
    return allFacts.filter(f => f.toLowerCase().includes(query.toLowerCase()));
  }

  async addFact(fact: string, namespace: string = "global"): Promise<void> {
    const existing = this.namespacedFacts.get(namespace) || [];
    if (!existing.includes(fact)) {
      existing.push(fact);
      this.namespacedFacts.set(namespace, existing);
    }
  }
}
