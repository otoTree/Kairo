# Stateful Agent（Hz 驱动 + 不完整输入）在 Kairo 的落地方案

本文描述如何在当前 Kairo 项目里，把“无状态 LLM”改造成“可持续运行的有状态 Agent”：在固定频率（Hz）下，用不完整输入（partial observation）驱动状态更新与主动行动。

## 1. 现有架构映射

Kairo 目前是一个极简的微内核 + 插件框架：

- 核心只负责插件生命周期与服务注册：Application 的 `use/setup/start/stop`（见 [app.ts](file:///Users/hjr/Desktop/Kairo/src/core/app.ts)）
- 插件通过 `setup(app)` 注册服务给其他插件使用（见 [ai.plugin.ts](file:///Users/hjr/Desktop/Kairo/src/domains/ai/ai.plugin.ts)）
- AI 域已提供 `ai.chat(messages, options)` 作为最小 LLM 能力（见 [AIPlugin.chat](file:///Users/hjr/Desktop/Kairo/src/domains/ai/ai.plugin.ts#L34-L37)）

因此，“Stateful Agent”最自然的落地方式是：新增一个 Agent 域插件（AgentPlugin），在 `start()` 中启动 Hz 循环，在 `stop()` 中停止循环，并在 `setup()` 中把 agent runtime / memory / observation bus 注册成服务供其他域复用。

## 2. 目标与设计约束

### 2.1 目标

- 输入可以是不完整的、碎片化的、时间切片式的（每 tick 只拿到一小段世界状态）
- Agent 每 tick 都会更新内部状态（memory），并可选择输出动作（可能是 noop）
- 当信息缺口足够大时，Agent 会优先输出“主动询问/探索”的动作，而不是强行给出结论

### 2.2 约束

- LLM 本身无状态：每次调用都只依赖本次 prompt
- 状态必须由外部系统维护：memory、tick 时钟、观察缓冲区
- 插件化：核心层不引用具体 Agent 实现；Agent 通过服务暴露能力

## 3. 状态公式（与实现一一对应）

定义符号：

- `t`：离散 tick 序号（与 Hz 绑定）
- `Δ = 1 / Hz`：tick 间隔
- `x_t`：第 t 个 tick 观测到的“部分输入”（partial observation）
- `m_t`：第 t 个 tick 的记忆（memory state）
- `s_t`：第 t 个 tick 的内部推理结果（可不对外暴露）
- `y_t`：第 t 个 tick 的对外动作（action）

单步更新：

1) 组合输入（把不完整输入补到可推理的上下文）：

```
input_t = Compose(x_t, m_{t-1}, t, Hz)
```

2) 语言模型推理（无状态）：

```
(s_t, y_t) = LM(input_t)
```

3) 记忆更新（即使输入不完整也要记）：

```
m_t = MemoryUpdate(m_{t-1}, x_t, s_t, y_t)
```

这三个步骤分别对应工程里的三个模块：

- Compose：prompt 构造器（prompt builder）
- LM：AIPlugin（或未来可插拔 provider）
- MemoryUpdate：memory service（摘要 + 索引 + 过期策略）

## 4. 最小可用实现（MVP）组件拆分

### 4.1 ObservationBus：把“碎片输入”聚合成 tick 可消费的片段

Agent 不应该直接依赖具体输入源（键盘、HTTP、传感器、文件变更等），而是依赖一个统一的观测总线：

- `publish(observation)`：其他域把“事件/输入碎片”投递进来
- `snapshot()`：在每个 tick 生成 `x_t`（可以是“上次 tick 以来新增事件列表” + “若干最新状态快照”）

推荐最小数据结构（TypeScript 形状）：

```ts
export type Observation =
  | { type: "user_message"; text: string; ts: number }
  | { type: "system_event"; name: string; payload?: unknown; ts: number };

export interface ObservationBus {
  publish(obs: Observation): void;
  snapshot(): { observations: Observation[]; ts: number };
}
```

实现上可以用一个数组缓冲区：每个 tick `snapshot()` 把数组清空并返回累计事件；这样就天然产生了“不完整输入”的时间切片特性。

### 4.2 Memory：把历史压缩成可控的上下文窗口

MVP 版本建议做两层：

- **短期记忆（STM）**：最近 N 个 tick 的事件与动作，按顺序保留（类似 ring buffer）
- **长期摘要（LTM）**：当 STM 过长时，把关键事实与进行中的目标压缩成摘要文本

最小接口：

```ts
export interface AgentMemory {
  getContext(): string;
  update(params: {
    observation: string;
    thought: string;
    action: string;
  }): void;
}
```

注意：这里的 `thought` 是否落盘是策略问题。若担心存储敏感推理过程，可只存“状态摘要”和“公开动作”；工程上可以通过配置开关控制。

### 4.3 AgentRuntime：Hz 循环、编排 LLM、产出动作

AgentRuntime 持有：

- `ai: AIPlugin`（通过 `app.getService("ai")` 获取）
- `memory: AgentMemory`
- `bus: ObservationBus`
- `hz: number`

tick 逻辑：

1) `x_t = bus.snapshot()`
2) `prompt = Compose(x_t, memory.getContext(), t, hz)`
3) `raw = await ai.chat([...])`
4) `Parse(raw) => { thought, action }`
5) `memory.update(...)`
6) `Dispatch(action)`（可能是 noop；可能是向 bus 发布 query；可能是调用其他服务）

示例 prompt 结构（强调“动作可为空”与“主动询问”）：

```text
你是一个持续运行的 Agent。每次 tick 都必须输出 JSON：
{
  "thought": "...",
  "action": { "type": "noop|say|query", "payload": "..." }
}

当前 tick: t=123, hz=3

记忆摘要:
...

新增观测（可能不完整）:
...

规则：
1) 如果信息缺口大，优先输出 query
2) 如果没有新信息且无需行动，输出 noop
```

### 4.4 AgentPlugin：用插件生命周期托管 runtime

Agent 作为一个域插件的原因：

- 与 core 解耦：core 不需要知道 “Hz 循环” 的存在
- 生命周期清晰：`start()` 启动循环，`stop()` 释放资源
- 服务可复用：把 `bus/memory/runtime` 注册为服务，其他域可推送观测或订阅动作

## 5. Hz 循环的工程实现要点

### 5.1 setInterval vs 自驱动循环

建议使用“自驱动异步循环”而非简单 `setInterval(async () => ...)`，避免上一轮 tick 未完成导致并发堆积。

逻辑：

- 计算下一次 tick 的目标时间
- `await sleep(remainingMs)` 后进入下一轮
- 如果某次推理耗时过长，下一次 tick 允许“赶进度”或“跳帧”（策略二选一）

### 5.2 输出可能是 noop

与传统“输入→输出”不同，tick 驱动系统中完全允许：

- 新增观测为空
- 仍然运行一次轻量决策
- 输出 noop 并只做内部状态维护

这样可以保持“持续存在”的节奏，同时避免无意义地刷屏。

## 6. “不完整输入”如何触发主动探索

核心策略是引入一个显式的“信息缺口评估”，使得 Agent 在不确定性高时倾向于 query。

工程上最简单的实现方式是：把“是否需要更多信息”的判断交给 LLM，但通过强约束 prompt 来提高一致性：

- 明确列出当前任务目标（来自 memory）
- 明确列出缺失字段（例如：用户意图、关键参数、时间范围等）
- 让模型必须在 `noop / query / say` 中三选一

如果需要更稳定，可以再叠加一个非 LLM 的规则层：

- 当 `observations` 为空且没有 pending goal：直接 noop
- 当出现用户消息但缺少关键槽位：强制 query
- 当连续 K 次 query 未得到补全：降低频率或切换到保守策略

## 7. 在 Kairo 里如何接入输入源（示例路径）

当前代码里还没有具体的输入源域（例如 HTTP/CLI/WebSocket）。推荐做法：

- 输入源域插件只负责把外部事件转换为 Observation 并 `bus.publish(...)`
- Agent 域只依赖 ObservationBus，而不依赖输入源插件内部结构

随着项目演进，你可以新增例如：

- `domains/http`：把请求体、headers、路由命中等发布为 observation
- `domains/cli`：把 stdin 的按键流（甚至“未完成的输入”）发布为 observation
- `domains/fswatch`：把文件变更事件发布为 observation

## 8. 推荐的落地顺序（以最少改动快速跑通）

1) 新增 `domains/agent` 插件，内部实现 ObservationBus + Memory + Runtime（先都放在域内）
2) 在 `src/index.ts` 里注册 AgentPlugin，Hz 设为 1–3（先慢一点好调试）
3) 写一个最简单的输入源：比如在 start 时发布一条 system_event，让 agent 能动起来
4) 再逐步引入真实输入源（CLI/HTTP），并把 action dispatch 扩展成调用其他服务

