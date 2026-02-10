# Server Bridge（WebSocket 事件转发）规格说明（MVP）

## 1. 目标

提供一个最薄的交互层，把 EventBus 的关键事件实时转发到 Web 客户端（或其他 UI）：
- 不引入业务逻辑
- 不改变事件语义
- 只负责订阅与广播

## 2. 范围与非目标

进入 v0.1：
- WebSocket 广播：thought/action/tool.result/system.log
- 静态资源托管（可选）

不进入 v0.1：
- UI 权限体系与鉴权（如需可在 v0.2+ 做 token）
- 复杂查询接口（历史由 replay/DB 提供）

## 3. 现状对齐（代码基线）

- Server 插件：[server.plugin.ts](file:///Users/hjr/Desktop/Kairo/src/domains/server/server.plugin.ts)

## 4. 对外契约（WebSocket）

MVP 约定：
- 服务端对每条 EventBus 事件，直接广播其完整 `KairoEvent` JSON
- 客户端不依赖隐式字段（仅依赖事件信封字段）

最小订阅集（当前实现事实）：
- `kairo.agent.thought`
- `kairo.agent.action`
- `kairo.tool.result`
- `kairo.system.log`

## 5. 依赖关系

Server Bridge 依赖：
- Agent Plugin（拿到 globalBus）
- Eventing（事件类型与信封稳定）

## 6. 验收标准（MVP）

- Agent 产生 thought/action 时，WebSocket 客户端能实时收到对应事件
- tool.result 事件能实时到达并携带 correlationId（若存在）

