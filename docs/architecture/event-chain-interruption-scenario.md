# “中途插话”的人类式事件链路（AgentOS 全事件模型示例）

## 1. 场景
用户发来一条输入，Agent 决定执行一个长耗时动作（例如启动外部二进制/工具）。动作已经开始执行时，用户又发来新输入。Agent “记得”上次 action 还在跑，并根据新输入调整（继续等待、追加步骤、取消、改参数、查询进度等）。

这个场景的关键不是“任务状态机”，而是：**在完全事件系统里，用事件把“正在进行”表达出来，并让后续输入能自然接续**。

## 2. 角色与通道
- User：产生自然语言输入
- Router/Orchestrator：把 `kairo.user.message` 路由到 `kairo.agent.{id}.message`
- Agent（user space）：消费事件 → 语言理解（用户语言 + 系统语言）→ 产出动作事件
- Tool/Skill/Kernel：执行系统调用（进程、IO、文件、设备等），并产出结果/状态事件
- EventBus：唯一事实来源（可回放）；Agent 的“记忆”来自事件回放 + 自己的摘要存储

## 3. 事件类型（建议最小集合）

### 3.1 用户语言事件（Natural Language）
- `kairo.user.message`：系统入口（可能带 targetAgentId）
- `kairo.agent.{id}.message`：路由后的“投递给某个 Agent 的用户语言”

data 建议：
```ts
type AgentMessage = {
  text: string;
  messageId: string;
};
```

### 3.2 Agent 动作事件（Action as Event）
- `kairo.agent.action`：Agent 决策的下一步动作（工具调用/系统调用/回复用户）

data 建议：
```ts
type AgentAction =
  | { type: "say"; text: string }
  | { type: "tool_call"; tool: string; args: any };
```

### 3.3 工具执行事件（Tool Execution）
- `kairo.tool.invoke`：某个 tool 开始执行（由 tool runner 发出）
- `kairo.tool.result`：tool 执行完成（成功/失败）（由 tool runner 发出）

data 建议：
```ts
type ToolInvoke = { tool: string; args: any };
type ToolResult = { ok: boolean; result?: any; error?: string };
```

### 3.4 系统语言事件（System Language）
系统语言是结构化事件，Agent 必须能“读懂并据此推进”：
- `kairo.process.spawned` / `kairo.process.exited` / `kairo.process.canceled`
- `kairo.system.>`（电量、设备、健康等）
- 可选：`kairo.process.progress`（通常由 wrapper/skill 解析产生，低频结构化）

高频输出不建议进入 EventBus（避免持久化爆炸），走 IPC 的 `STREAM_CHUNK` 实时链路即可。

## 4. 关联规则（没有状态机也能串成“经历”）
Kairo 的事件信封已有 `correlationId/causationId` 字段：[types.ts](file:///Users/hjr/Desktop/Kairo/src/domains/events/types.ts)。

为支撑“中途插话”，建议采用极简关联习惯：
- **messageId**：每条用户消息自带（或由入口生成），用于去重与引用
- **actionId**：`kairo.agent.action` 的 event.id（天然唯一）
- **correlationId（可选但强烈建议）**：一次“行动链”共享，用于把一串事件聚合为一次连续经历
  - 不是“意图状态机”，只是“把事件串起来的线”
- **causationId（建议）**：某条事件直接由哪条事件触发（例如 action 由某条 message 触发；tool.result 由 tool.invoke 触发）

最重要的一点：
- Agent 判断“上次 action 已经开始执行但未完成”，不靠内存里的 flag，而靠 **事件事实**：存在 `kairo.agent.action` 且其后尚未出现对应的 `kairo.tool.result` / `kairo.process.exited`（依据 action 类型）。

## 5. 链路示例：第一次输入 → 启动长任务 → 中途第二次输入

### 5.1 时间线（线性视图）

1) 用户发第一条消息
- `kairo.user.message`（source=user）
- Router 发布 `kairo.agent.default.message`（source=orchestrator）

2) Agent 读到消息并决定执行工具
- Agent 发布 `kairo.agent.thought`（可选，仅用于可观测）
- Agent 发布 `kairo.agent.action`（data: tool_call）
  - causationId = 第一条 message 的 event.id
  - correlationId = 可选（例如 `"chain:<messageId>"`）

3) tool runner 执行工具（例如 spawn 一个外部进程）
- tool runner 发布 `kairo.tool.invoke`
  - causationId = actionId
  - correlationId = 同上（若使用）
- Kernel/Skill 开始执行，发布系统语言事件：
  - `kairo.process.spawned`（包含 processId/pid）

4) 用户发第二条消息（中途插话）
- `kairo.user.message`
- Router 发布 `kairo.agent.default.message`

5) Agent 再次 tick：它“记得”上次 action 在跑
Agent 在消费第二条 message 时，会从事件流中读到：
- 最近一个未闭合的执行链：tool.invoke 已发生，但对应 `kairo.tool.result` 未发生（或 process.exited 未发生）
- 并且还在收到 process 相关事件（progress/状态）

于是 Agent 可以基于第二条消息决定：
- 继续等待并解释当前进度
- 查询状态（再发一个 tool_call）
- 取消当前动作（发 tool_call → kill/signal）
- 启动一个并行动作（如果允许并发）

### 5.2 “中途插话”的两种人类反应模式

#### A. 插话是“询问进度”
用户：现在到哪了？
Agent 行为：
- 不需要新建任何“意图对象”
- 只需发一个动作：查询或总结现状

事件链（简化）：
- `kairo.agent.default.message`（第二条）
- `kairo.agent.action`（say：汇报进度 或 tool_call：process.status）
- `kairo.tool.invoke` → `kairo.tool.result`
- `kairo.agent.action`（say：把 result 翻译成用户语言）

#### B. 插话是“改变主意/取消”
用户：别做了，停掉
事件链（简化）：
- `kairo.agent.default.message`（第二条）
- `kairo.agent.action`（tool_call：process.kill / process.signal）
- `kairo.tool.invoke` → `kairo.tool.result`
- `kairo.process.canceled` / `kairo.process.exited`
- `kairo.agent.action`（say：确认已停止 + 清理说明）

## 6. 并发语义（中途插话时系统如何“不乱”）

### 6.1 单 Agent 的执行模型（建议）
同一 Agent 可以采用“单线程决策 + 多任务执行”的模型：
- 决策（LLM tick）串行：一次只处理一个触发点（某条 message 或某个 tool.result）
- 执行并行：多个 tool 调用/进程可以同时在跑

“正在进行”的表示方式：
- 每个在跑的执行链都必须能在事件流中被识别（至少通过 actionId 或 toolInvokeId）

### 6.2 去重与幂等（必须考虑）
事件系统天然可能出现重复投递/重放：
- 用户消息：用 `messageId` 去重
- 工具调用：用 `actionId` 作为幂等 key（同一个 action 不重复执行）
- 进程类动作：processId 由系统生成或由 action 派生，确保重复执行不会 spawn 两次

### 6.3 顺序保证（最小假设）
不要假设全局严格顺序；只假设：
- 同一个 tool invocation 的 `invoke → result` 有 causationId/关联 key 可匹配
- 同一个 process 的系统事件能按 seq 或时间戳近似排序（用于 UI）

## 7. Agent “读懂系统语言”的最小要求
Agent 不需要理解所有系统事件，只需要识别三件事：
- **发生了什么**：event.type
- **与我哪次 action 有关**：correlationId/causationId/携带的 processId/toolInvokeId
- **下一步怎么推进**：生成新的 `kairo.agent.action`

为了降低 LLM 不确定性，建议把系统语言事件 data 设计成“像 API 返回值一样稳定”，并避免把原始日志直接丢给 Agent。

## 8. 与现有实现的对齐点（当前即可落地的部分）
- AgentRuntime 已订阅 `kairo.tool.result`、`kairo.agent.{id}.message`、`kairo.system.>`：[runtime.ts](file:///Users/hjr/Desktop/Kairo/src/domains/agent/runtime.ts)
- EventBus 事件信封已提供 correlationId/causationId 字段：[types.ts](file:///Users/hjr/Desktop/Kairo/src/domains/events/types.ts)
- 事件持久化/回放能力已有雏形（RingBufferEventStore + replay）：[in-memory-bus.ts](file:///Users/hjr/Desktop/Kairo/src/domains/events/in-memory-bus.ts)

尚缺但与本场景强相关（见 MVP 文档）：
- 进程 IO 事件化与 IPC push（stdout/stderr 的 STREAM_CHUNK，exit 的 EVENT）
- 工具层把 actionId/correlationId/cause 贯通到 tool.invoke/tool.result

## 9. 验收（如何证明“这已经是人类了”）
- 在一个长任务运行中，用户连续发 3 次消息（问进度/改参数/取消），Agent 每次都能基于“事件事实”给出一致响应
- 重启后回放事件流，Agent 仍能判断哪些动作已完成、哪些仍在进行（或明确为已中断）
- UI 只订阅事件与流，不需要直接读 Agent 内存才能还原当前状态

