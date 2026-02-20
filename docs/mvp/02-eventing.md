# Eventing（EventBus + EventStore + Sequencing）规格说明（MVP）

## 1. 目标

提供 AgentOS 的“神经系统”，用于跨域解耦与可回放：
- 稳定事件信封（KairoEvent）
- 发布/订阅（支持 `*` 与 `>` 通配）
- replay（用于构建 Agent 上下文与 UI 历史）
- 最小序列语义（correlationId/causationId/取消语义；以事件顺序自然回溯）

## 2. 组成

MVP 内 Eventing 由三部分构成：
- EventBus：发布/订阅/request/replay 的统一接口
- EventStore：append/query（写入异步，不阻塞事件循环）
- Sequencing 约定：跨 IPC/进程/工具的关联字段与事件类型约定

## 3. 现状对齐（代码基线）

- 事件类型与接口：[types.ts](file:///Users/hjr/Desktop/Kairo/src/domains/events/types.ts)
- InMemoryGlobalBus（mitt + wildcard + 自动持久化）：[in-memory-bus.ts](file:///Users/hjr/Desktop/Kairo/src/domains/events/in-memory-bus.ts)
- EventStore（当前为 Hybrid：内存 buffer + SQLite 异步持久化）：[event-store.ts](file:///Users/hjr/Desktop/Kairo/src/domains/events/event-store.ts)
- DB EventRepository：[event-repository.ts](file:///Users/hjr/Desktop/Kairo/src/domains/database/repositories/event-repository.ts)

参考背景：
- [global-event-bus-spec.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/global-event-bus-spec.md)
- [agentos-mvp.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/agentos-mvp.md)

## 4. 稳定对外契约

### 4.1 事件信封（KairoEvent）

必须字段：
- `id`：事件唯一 ID（UUID）
- `type`：点分隔类型（例如 `kairo.agent.action`）
- `source`：事件来源（例如 `agent:default` / `system:kernel`）
- `specversion`：固定 `"1.0"`
- `time`：ISO 时间
- `data`：业务负载

可选字段（Sequencing）：
- `correlationId`：贯穿一次意图/一次请求链路
- `causationId`：表示由哪个事件触发

### 4.2 主题订阅语义

订阅 pattern 支持：
- 精确匹配：`kairo.agent.thought`
- 单段通配 `*`：`kairo.agent.*.message`
- 多段通配 `>`：`kairo.process.>`

### 4.3 request/response（EventBus 层）

MVP 允许在 EventBus 上使用 request/response 语义，用于：
- UI ↔ 服务
- Agent ↔ 系统工具（当无需走 Kernel IPC 时）

约束：
- request 生成 `correlationId`
- response 必须带相同 `correlationId`
- timeout 必须可配置

## 5. Sequencing 约定（必须遵守）

### 5.1 correlationId 贯通

以下链路必须尽可能携带 correlationId（缺失会导致“经历”不可回放）：
- Agent 产出的 action 事件
- 工具调用与工具结果事件
- Kernel IPC 请求与 Kernel 发布的结构化事件（spawned/exited/canceled）

### 5.2 取消语义（必须）

v0.1 不引入“intent.started/ended”这类边界事件；一次行动的边界来自：
- 触发事件（通常是 `kairo.user.message` 或某条 `kairo.tool.result`）的时间顺序
- 关键副作用的完成事件（例如 `kairo.tool.result`、`kairo.process.exited`）

取消的最小要求是“可取消且可回放”，而不是“必须有固定 cancel 事件名”。要求：
- 取消操作必须能落到实际副作用资源上（例如通过 `process.kill` 终止进程，或 tool runner 的 cancel 入口停止工具执行）
- 事件流必须出现明确的取消事实：`kairo.tool.result` 标记 canceled，或 `kairo.process.canceled`，并最终收敛到 `kairo.process.exited`（如已退出则至少 exited）

## 6. 依赖关系

Eventing 的依赖：
- Core Runtime（用于注入/共享）
- Database（可选；若启用 replay 的历史需求，则必须）

Eventing 的被依赖方：
- Agent Runtime（消费/产出事件）
- Kernel（发布系统事件、桥接设备/指标）
- Skills（发布工具/技能事件、消费 action）
- Server（转发事件到前端）

## 7. 验收标准（MVP）

- `publish/subscribe` 支持精确与通配订阅
- `append` 不阻塞发布路径（写入失败不应崩溃进程）
- `replay(limit=N)` 能返回最近 N 条事件（在 DB 可用时正确返回）
- correlationId 能贯通 “action → tool.result → 下一步 action” 链路（可通过集成测试验证）
