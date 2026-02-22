# Kairo Memory 系统：仿生 Markdown 记忆架构

## 1. 设计理念

保留 MemCube 的仿生分层记忆模型，但将存储介质从向量数据库替换为纯 Markdown 文件。

核心原则：
- 仿生分层：保留工作记忆 / 情景记忆 / 长期记忆的三层模型
- 人类可读：所有记忆以 Markdown 明文存储，可直接编辑
- 零原生依赖：不再需要 lmdb、hnswlib-node、msgpackr、minisearch
- Git 友好：纯文本，可版本控制

## 2. 仿生分层模型

```
┌─────────────────────────────────────────────────┐
│  L1: 工作记忆 (Working Memory)                    │
│  类比：前额叶皮层                                  │
│  文件：working.md                                 │
│  特点：短期、高频更新、容量有限（自动清理最旧条目）    │
├─────────────────────────────────────────────────┤
│  L2: 情景记忆 (Episodic Memory)                   │
│  类比：海马体                                      │
│  文件：episodic.md                                │
│  特点：具体经历和事件流，可晋升为长期记忆             │
├─────────────────────────────────────────────────┤
│  L3a: 语义记忆 (Semantic Memory)                  │
│  类比：大脑皮层                                    │
│  文件：semantic.md                                │
│  特点：抽象知识、规则、用户偏好，永久保留             │
├─────────────────────────────────────────────────┤
│  L3b: 闪光灯记忆 (Flashbulb Memory)              │
│  类比：杏仁核                                      │
│  文件：flashbulb.md                               │
│  特点：高情感/高重要性的核心时刻，原样永久保留        │
└─────────────────────────────────────────────────┘
```

## 3. 存储结构

```
data/memory/
  {namespace}/              # "default" 或 Agent 标识符
    working.md              # L1: 工作记忆
    episodic.md             # L2: 情景记忆
    semantic.md             # L3a: 语义记忆
    flashbulb.md            # L3b: 闪光灯记忆
```

## 4. Markdown 文件格式

```markdown
# Episodic Memory

---
<!-- id:abc123 | created:1708700000000 | importance:7 | tags:pdf,满意 -->
用户首次使用 PDF 发票汇总功能，处理了 5 个文件，对提取速度表示满意。
---
<!-- id:def456 | created:1708700100000 | importance:5 | tags:debug -->
用户调试了一个 API 超时问题，最终发现是 DNS 解析延迟。
```

### 元数据字段
| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 唯一标识符 |
| `created` | 是 | 创建时间戳（毫秒） |
| `importance` | 是 | 重要性 1-10 |
| `tags` | 否 | 逗号分隔的标签 |

## 5. 各层级行为

### L1 工作记忆
- 存储当前会话上下文、临时状态
- 容量限制：默认最多 50 条，超出自动清理最旧条目
- 默认 importance = 3

### L2 情景记忆
- 存储具体经历、对话要点、事件
- 无自动清理，但支持手动清理
- 可通过 `consolidate` 工具聚合为 L3 语义记忆

### L3a 语义记忆
- 存储抽象知识：用户偏好、项目规则、学到的模式
- 永久保留
- 来源：手动添加 或 L2 consolidation 生成

### L3b 闪光灯记忆
- 存储高重要性（importance ≥ 8）的核心时刻
- 永久保留，原样保存完整细节
- 来源：手动标记 或 L2 中 importance ≥ 8 的条目自动晋升

## 6. API 设计

```typescript
class MemoryStore implements LongTermMemory {
  // 添加记忆到指定层级
  add(content: string, options?: {
    namespace?: string;
    layer?: MemoryLayer;
    importance?: number;
    tags?: string[];
  }): Promise<string>;

  // 关键词搜索（跨层级）
  recall(query: MemoryQuery | string, namespace?: string): Promise<MemoryResult[] | string[]>;

  // 删除记忆
  forget(id: string, namespace?: string): Promise<boolean>;

  // 列出记忆
  list(namespace?: string, layer?: MemoryLayer): Promise<MemoryEntry[]>;

  // 固化：将 L2 情景记忆聚合为 L3 语义摘要（需 AI）
  consolidate(namespace?: string): Promise<string[]>;

  // LongTermMemory 接口
  memorize(content: string): Promise<void>;
}
```

## 7. Agent 工具

| 工具名 | 描述 |
|--------|------|
| `memory_add` | 添加记忆（可指定层级和重要性） |
| `memory_recall` | 关键词搜索记忆 |
| `memory_forget` | 删除指定记忆 |
| `memory_list` | 列出记忆（可按层级过滤） |
| `memory_consolidate` | 将 L2 情景记忆固化为 L3 语义摘要 |

## 8. 记忆流转

```
用户交互 ──→ L1 工作记忆（短期缓存）
                │
                ▼ （重要事件）
            L2 情景记忆（具体经历）
                │
        ┌───────┴───────┐
        ▼               ▼
  consolidate      importance ≥ 8
        │               │
        ▼               ▼
  L3a 语义记忆    L3b 闪光灯记忆
  （抽象知识）    （核心时刻）
```

## 9. 与旧系统对比

| 特性 | MemCube（旧） | MemoryStore（新） |
|------|---------------|-------------------|
| 存储 | LMDB + HNSW + MiniSearch | 纯 Markdown 文件 |
| 分层模型 | L1/L2/L3 | L1/L2/L3a/L3b（更细分） |
| 检索 | RRF 混合检索（向量+关键词） | 关键词匹配 + importance 加权 |
| 依赖 | 4 个原生模块 | 0（仅 Node.js fs） |
| 遗忘曲线 | 自动（Ebbinghaus） | 手动清理 / L1 容量限制 |
| 固化 | 自动（每小时） | 手动触发（Agent 工具） |
| 闪光灯晋升 | 自动（GC 中检测） | 添加时自动检测 |
| 人类可编辑 | 否 | 是 |
| Git 友好 | 否 | 是 |
