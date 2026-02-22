/**
 * 仿生记忆层级
 */
export enum MemoryLayer {
  Working = "working",       // L1: 工作记忆（前额叶皮层）— 短期上下文
  Episodic = "episodic",     // L2: 情景记忆（海马体）— 具体经历
  Semantic = "semantic",     // L3a: 语义记忆（大脑皮层）— 抽象知识
  Flashbulb = "flashbulb",   // L3b: 闪光灯记忆（杏仁核）— 核心时刻
}

/**
 * 单条记忆条目
 */
export interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  content: string;
  importance: number;        // 重要性 1-10
  tags: string[];
  createdAt: number;
}

/**
 * 记忆查询参数
 */
export interface MemoryQuery {
  text: string;              // 搜索关键词
  layer?: MemoryLayer;       // 限定层级
  tags?: string[];           // 限定标签
  minImportance?: number;    // 最低重要性
  limit?: number;            // 最大返回数量
}

/**
 * 记忆查询结果
 */
export interface MemoryResult {
  entry: MemoryEntry;
  score: number;             // 综合得分（关键词匹配 + importance 加权）
}
