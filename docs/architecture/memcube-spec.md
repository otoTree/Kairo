# MemCube: AI 原生记忆体架构 (AI-Native Memory Infrastructure)

## 1. 核心定位 (Core Philosophy)

**MemCube** 不是一个通用的向量数据库，也不是传统的缓存系统。它是专为 AI Agent 设计的**类人记忆基础设施 (The Hippocampus for Agents)**。

其设计目标是赋予 Agent 像人类一样的记忆能力：
*   **分层 (Hierarchical)**: 区分瞬时的工作记忆与长期的语义记忆。
*   **动态 (Dynamic)**: 记忆会随时间衰减（遗忘），也会因回顾而强化。
*   **关联 (Associative)**: 通过语义、时间、实体关系多维检索，而非简单的 SQL 查询。

## 2. 记忆分层模型 (The Memory Hierarchy)

MemCube 采用仿生学的分层存储架构，在性能、容量和成本之间取得极致平衡。

| 层级 (Layer) | 类比 (Analogy) | 存储介质 (Storage) | 延迟 (Latency) | TTL/容量 | 用途 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **L1: 工作记忆**<br>(Working Memory) | 前额叶皮层 | **LMDB** (Memory Map) | < 10µs | ~1小时<br>(极小) | 存储当前会话上下文、正在进行的任务状态。掉电易失（可配置持久化）。 |
| **L2: 情景记忆**<br>(Episodic Memory) | 海马体 | **HNSW** (Vector)<br>+ **LMDB** (Data) | 10-50ms | ~30天<br>(缓冲区) | 存储具体的经历、事件流。高情感/高重要性的事件会**晋升**为 L3，否则随时间遗忘。 |
| **L3: 长期记忆**<br>(Long-term Memory) | 大脑皮层 | **Parquet** (File)<br>+ **S3/Disk** | 100ms+ | 永久<br>(无限) | 包含两类：<br>1. **语义记忆 (Semantic)**: 抽象的知识与规则。<br>2. **核心情景 (Core Episodic)**: 极其重要的历史时刻（如“闪光灯记忆”）。 |

## 3. 技术选型 (Tech Stack)

坚持 **Local-First** 与 **Full-Stack TypeScript** 策略，确保在边缘设备（如树莓派/Mac）上的极致性能与零依赖部署。

*   **KV 存储 (Storage)**: **LMDB** (`lmdb-js`)
    *   *理由*: 内存映射文件 (mmap)，读取性能达到微秒级，远超 SQLite。
*   **向量引擎 (Vector)**: **hnswlib-node**
    *   *理由*: 经过实战检验的 C++ 核心，提供极高效的 HNSW 索引构建与检索。
*   **全文检索 (Inverted Index)**: **MiniSearch**
    *   *理由*: 纯 TS 实现，零依赖，支持前缀搜索和模糊匹配，适合混合检索。
*   **序列化 (Serialization)**: **msgpackr**
    *   *理由*: 比 JSON 快 5 倍，二进制紧凑格式，原生支持 Buffer。

## 4. 核心设计机制 (Core Mechanics)

### 4.1 三维数据模型 (3D Data Model)
MemCube 中的每一条记忆（Memory Entry）都由三个维度定义：
1.  **行 (Entity)**: 实体锚点（User ID, Session ID, Agent ID）。
2.  **列 (Attributes)**: 记忆属性。
    *   `importance` (1-10): 重要性评分。
    *   `sentiment` (-1.0 ~ 1.0): 情感偏向。
    *   `confidence` (0.0 ~ 1.0): 事实置信度。
3.  **时间 (Time/Version)**: **MVCC + Time Travel**。
    *   支持查询“过去某个时间点”的记忆状态（例如：“上周这个时候我对这个项目的看法是什么？”）。

### 4.2 动态遗忘机制 (Forgetting Curve)
模仿 **Ebbinghaus 遗忘曲线**，记忆的留存率 $R$ 随时间 $t$ 衰减：
$$ R = e^{-\frac{t}{S}} $$
*   $S$ (Memory Strength) 由 **重要性 (Importance)** 和 **复习频率 (Repetition)** 决定。
*   **清理策略**: 定期扫描 L2 情景记忆，$R$ 值低于阈值的记忆将被“遗忘”（软删除或归档）。

### 4.3 记忆压缩与固化 (Consolidation)
从 L2 到 L3 的转化包含两条路径：

1.  **抽象化路径 (Abstraction)**:
    *   **事件聚合**: 将过去 24 小时内的 100 条琐碎交互聚合成 1 条摘要。
    *   **知识提取**: 从对话中提取事实（例如 "User likes dark mode"），存入 L3 语义区。

2.  **晋升路径 (Promotion) - 闪光灯记忆 (Flashbulb Memory)**:
    *   当某条 L2 记忆的 `importance > 8` 且 `sentiment` 强烈时（例如：用户第一次表达强烈的喜爱或愤怒，或重大里程碑事件），该情景记忆会被**原样**复制到 L3，成为永久的“核心情景”。
    *   这解释了为何 Agent (和人类) 能清晰回忆起很久以前的关键时刻。

### 4.4 混合检索 (Hybrid Retrieval - RRF)
使用 **RRF (Reciprocal Rank Fusion)** 算法合并多种检索结果：
1.  **语义检索**: HNSW 向量相似度（理解意图）。
2.  **关键词检索**: MiniSearch BM25（精确匹配专有名词）。
3.  **时空检索**: 过滤最近时间窗口或特定实体。
4.  **关联图谱**: (Roadmap) 基于图数据库的实体跳跃。

### 4.5 反馈闭环 (Reinforcement Loop)
记忆系统具备自我进化能力：
*   **正反馈**: 用户采纳了 Agent 基于某条记忆的建议 → 该记忆 `importance +1`，`S` 增加（更难遗忘）。
*   **负反馈**: 用户纠正 Agent → 错误记忆 `importance -1` 或标记为 `invalid`。
*   **传播**: 重要性变化会沿着语义相似度传播到相关记忆。

## 5. 交互协议 (Interaction Protocol)

### 5.1 盲盒编排 (Blind Orchestration)
Agent 依然无法直接遍历数据库，遵循 Kairo 的安全设计：
*   **Intent**: `memory.recall(query, context)`
*   **Output**: 经过排序、过滤、鉴权后的 Context 片段。

### 5.2 API 示例
```typescript
interface MemorySystem {
  // 写入记忆 (自动路由到 L1/L2)
  add(content: string, meta: MemoryMeta): Promise<string>;
  
  // 混合检索
  recall(query: string, options: {
    weights: { semantic: 0.7, recency: 0.2, keyword: 0.1 };
    min_importance: 3;
  }): Promise<MemoryItem[]>;
  
  // 强制固化 (L1 -> L2 -> L3)
  consolidate(): Promise<Summary>;
}
```

## 6. 路线图 (MVP Roadmap)
*   **Month 1**: 核心存储层 (LMDB + HNSW) 实现，打通 IPC 接口。
*   **Month 2**: 实现遗忘曲线算法与后台 GC 任务。
*   **Month 3**: 实现 RRF 混合检索与语义压缩 (Consolidator)。

## 7. 真实数据样例 (Data Examples)

以下展示了三种记忆层级中真实存储的数据结构示例。

### 7.1 L1 工作记忆 (Working Memory Entry)
*特点：瞬时、原始、包含完整上下文，用于维持当前对话的连贯性。*

```json
{
  "id": "wm_8f9a2b3c",
  "layer": "L1",
  "created_at": 1715421000000,
  "ttl": 3600, // 1小时后过期
  "content": "用户说：'帮我把这些 PDF 里的发票金额汇总一下'",
  "type": "conversation_turn",
  "metadata": {
    "role": "user",
    "session_id": "sess_001",
    "intent": "document_processing",
    "entities": ["PDF", "发票", "金额"]
  }
}
```

### 7.2 L2 情景记忆 (Episodic Memory Entry)
*特点：经过初步处理，带有 Embedding 向量、情感和重要性评分，用于未来的回溯。*

```json
{
  "id": "ep_7d6e5f4g",
  "layer": "L2",
  "created_at": 1715421050000,
  "last_accessed": 1715421050000,
  "content": "用户首次使用了 PDF 发票汇总功能，处理了 5 个文件，他对提取速度表示满意。",
  "vector": [-0.012, 0.45, ...], // 384维向量 (HNSW)
  "attributes": {
    "importance": 7,       // 较高重要性（功能偏好）
    "sentiment": 0.8,      // 正向情感
    "confidence": 1.0,     // 事实
    "memory_strength": 5.0 // 初始记忆强度
  },
  "context": {
    "tool_used": "pdf-extractor",
    "performance_metric": "2.3s"
  },
  "links": {
    "prev_event": "ep_7d6e5f4f", // 链式结构
    "related_entity": "ent_invoice_tool"
  }
}
```

### 7.3 L3 长期记忆 (Long-term Memory Entry)
*包含两类：抽象语义 与 核心情景。*

#### Type A: 语义记忆 (Semantic Knowledge)
```json
{
  "id": "sem_1a2b3c4d",
  "layer": "L3",
  "type": "semantic",
  "content": "用户偏好使用 PDF 格式处理财务文档，且关注处理速度。",
  // ... (同上)
}
```

#### Type B: 核心情景记忆 (Core Episodic / Flashbulb)
*特点：尽管发生在很久以前，但因为当时的情感/重要性极高，被完整保留了细节。*

```json
{
  "id": "core_ep_9z8y7x6w",
  "layer": "L3",
  "type": "core_episodic",
  "created_at": 1420070400000, // 10年前
  "content": "用户第一次向 Agent 透露了他的创业计划，当时他非常激动，详细描述了对未来的愿景。",
  "vector": [-0.05, 0.88, ...],
  "attributes": {
    "importance": 10,      // 顶级重要性
    "sentiment": 0.95,     // 极度兴奋
    "confidence": 1.0,
    "flashbulb": true      // 标记为闪光灯记忆
  },
  "context": {
    "weather": "rainy",    // 甚至保留了当时的环境细节
    "time_of_day": "late_night"
  }
}
```
