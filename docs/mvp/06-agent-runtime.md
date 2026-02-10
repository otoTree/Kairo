# Agent Runtime（User-space Orchestrator）规格说明（MVP v0.1）

## 1. 目标

从 AgentOS 视角，Agent 属于 user space 的“事件驱动编排器”：
- 持续消费事件（用户输入/系统事件/工具结果）
- 产出动作事件（下一步要做什么），并通过工具/IPC 驱动 Kernel/Skills
- 收敛高频输出为低频结构化里程碑，保持可回放与可观测
- 支持取消与清理（传播到 Kernel/Skills）

## 2. 范围与非目标

进入 v0.1：
- 单 Agent（default）即可，但架构允许多 Agent
- 基于 EventBus 的输入/输出契约（标准事件 + legacy 适配）
- 通过 system tools 与 MCP tools 扩展工具面

不进入 v0.1：
- 复杂 Job/Task 状态机（用事件序列表达经历）
- 长期可恢复会话（durability/recovery v0.2+）

## 3. 现状对齐（代码基线）

- Agent 插件（装配 globalBus、legacy adapter、memory）：[agent.plugin.ts](file:///Users/hjr/Desktop/Kairo/src/domains/agent/agent.plugin.ts)
- Agent 运行时（事件驱动循环、工具调用）：[runtime.ts](file:///Users/hjr/Desktop/Kairo/src/domains/agent/runtime.ts)
- Legacy ObservationBus 适配器：[observation-bus.ts](file:///Users/hjr/Desktop/Kairo/src/domains/agent/observation-bus.ts)
- Memory/SharedMemory：[memory.ts](file:///Users/hjr/Desktop/Kairo/src/domains/agent/memory.ts) / [shared-memory.ts](file:///Users/hjr/Desktop/Kairo/src/domains/agent/shared-memory.ts)

参考背景：
- [agentos-mvp-v0.1.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/agentos-mvp-v0.1.md#L209-L259)

## 4. 输入事件契约（Agent 必须消费）

MVP 最小集合：
- `kairo.user.message`：用户输入（orchestrator 路由）
- `kairo.agent.{id}.message`：路由到具体 agent 的输入（可选，但推荐）
- `kairo.tool.result`：工具执行结果（system tools 与 MCP tools）
- `kairo.process.*`：Kernel 发布的结构化进程事件（spawned/exited/canceled）
- `kairo.system.*`：系统事件（启动、指标、设备变更等）

约束：
- 对用户文本与系统结构化事件必须“同一循环内”可处理（避免状态分裂）

## 5. 输出事件契约（Agent 必须产出）

MVP 最小集合：
- `kairo.agent.thought`：思考/中间推理的可观测输出（可限制粒度）
- `kairo.agent.action`：下一步动作（工具调用/IPC 调用的意图表达）
- `kairo.tool.exec`：对工具层的执行请求（若系统采用事件驱动工具调用）

## 6. 工具面（Tools）

Agent 工具来源（MVP）：
- system tools：由各插件在启动时注册（例如 Skills/Sandbox/Kernel）
- MCP tools：由 MCPPlugin 提供外部工具桥接（可选）

约束：
- 工具调用必须有 correlationId，以便把 action → tool.result 串起来
- 工具结果必须进入 EventBus（用于 UI 与 replay）

## 7. 输出收敛与摘要（必须）

约束：
- stdout/stderr 高频输出留在实时链路（STREAM_CHUNK），Agent 不得全量写入长期记忆
- 只将关键里程碑结构化事件化（例如产物路径、错误原因、关键指标）

推荐模式：
- 当工具/进程结束时，产出一条 `kairo.agent.note`（或等价）作为摘要事件

## 8. 取消与清理（必须）

当收到 cancel（通常是用户指令）时：
- Agent 必须停止推进对应链路的后续 action
- Agent 必须通过工具/IPC 传播到 Kernel/Skills（终止进程、停止订阅、清理临时资源）
- 取消链路必须可回放：在事件流中出现明确“已取消/已终止”的事实（例如 `kairo.tool.result` canceled 或 `kairo.process.canceled` / `kairo.process.exited`），并尽可能保持 correlationId 连贯

## 9. 依赖关系

Agent Runtime 依赖：
- Eventing（输入/输出与 replay）
- AI（模型调用能力）
- Skills（系统工具与技能执行）
- Kernel（进程/设备/系统原语的最终执行者）
- MCP（可选，用于工具桥接）

Agent Runtime 被依赖：
- Server/UI（展示 thought/action/tool.result/system 事件）

## 10. 验收标准（MVP）

- 发布 `kairo.user.message` 能驱动 Agent 产生 `kairo.agent.thought/action`
- 一次工具调用能形成可回放链路：action/tool.exec → tool.result → 下一步 action（correlationId 连贯）
- 取消能停止后续 action 并触发 Kernel 终止进程
