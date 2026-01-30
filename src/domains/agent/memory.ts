import { promises as fs } from "fs";
import * as path from "path";
import type { AIPlugin } from "../ai/ai.plugin";

export interface AgentMemory {
  getContext(): string;
  update(params: {
    observation: string;
    thought: string;
    action: string;
    actionResult?: string;
  }): void;
  compress(ai: AIPlugin): Promise<void>;
}

export class InMemoryAgentMemory implements AgentMemory {
  private history: { observation: string; thought: string; action: string; actionResult?: string }[] = [];
  private summary: string = "";
  private readonly limit: number;
  private readonly storageDir: string;

  constructor(limit: number = 50) {
    this.limit = limit;
    this.storageDir = path.join(process.cwd(), "memory");
    this.initStorage();
  }

  private async initStorage() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch (error) {
      console.error("[Memory] Failed to create storage directory:", error);
    }
  }

  getContext(): string {
    const historyText = this.history
      .filter(h => {
          // Filter out empty observations with noop action
          try {
              const obs = JSON.parse(h.observation);
              const action = JSON.parse(h.action);
              if ((!obs || obs.length === 0) && action.type === 'noop') {
                  return false;
              }
              return true;
          } catch (e) {
              return true; // Keep if parse fails
          }
      })
      .map(
        (h, i, arr) =>
          `[Tick -${arr.length - i}]\nObservation: ${h.observation}\nThought: ${h.thought}\nAction: ${h.action}${h.actionResult ? `\nResult: ${h.actionResult}` : ''}`
      )
      .join("\n\n");

    if (!this.summary) {
        if (!historyText) return "无重要历史记录";
        return historyText;
    }

    return `【Previous Memory Summary】\n${this.summary}\n\n【Recent History】\n${historyText}`;
  }

  update(params: { observation: string; thought: string; action: string; actionResult?: string }) {
    this.history.push(params);
    // Hard limit just in case, though compression should handle it
    if (this.history.length > this.limit) {
      this.history.shift(); 
    }
  }

  async compress(ai: AIPlugin) {
    if (this.history.length <= 3) {
        console.log("[Memory] Not enough history to compress.");
        return;
    }

    console.log("[Memory] Compressing memory...");
    
    // Keep last 3 items, summarize the rest
    const keepCount = 3;
    const itemsToSummarize = this.history.slice(0, this.history.length - keepCount);
    const itemsToKeep = this.history.slice(this.history.length - keepCount);

    const historyToSummarize = itemsToSummarize
      .map(h => `Observation: ${h.observation}\nThought: ${h.thought}\nAction: ${h.action}${h.actionResult ? `\nResult: ${h.actionResult}` : ''}`)
      .join("\n\n");

    const contextToSummarize = this.summary 
      ? `Previous Summary:\n${this.summary}\n\nNew History:\n${historyToSummarize}`
      : historyToSummarize;

    const prompt = `You are a memory manager for an autonomous agent.
Please summarize the following memory content into a concise paragraph.
Retain key information, decisions, and current state.
Discard repetitive or trivial details.

${contextToSummarize}

Summary:`;

    try {
      const response = await ai.chat([
        { role: "system", content: "You are a helpful assistant that summarizes text." },
        { role: "user", content: prompt }
      ]);

      const newSummary = response.content;

      // Save archive to file
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `memory_archive_${timestamp}.md`;
      const filepath = path.join(this.storageDir, filename);
      
      await fs.writeFile(filepath, contextToSummarize);
      console.log(`[Memory] Archived to ${filepath}`);

      this.summary = newSummary;
      this.history = itemsToKeep;
      
      console.log("[Memory] Compression complete.");
    } catch (e) {
      console.error("[Memory] Compression failed:", e);
    }
  }
}
