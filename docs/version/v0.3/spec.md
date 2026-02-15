# v0.3 Technical Specification: Agent Runtime

## 1. 核心功能规范 (Core Features)

### 1.1 Agent 主循环 (Recall-Plan-Act-Memorize)
- **Recall**: 每一轮对话前，自动检索相关记忆。
- **Plan**: 基于上下文生成 Intent 和计划。
- **Act**: 执行 Tool Call 或 Say/Query 动作。
- **Memorize**: 交互结束后，自动总结并存入记忆。

### 1.2 全局事件总线 (Global Event Bus)
- **Event Driven**: 取代直接函数调用，所有 Agent 行为和工具结果通过 EventBus 传递。
- **Standard Events**: 定义 `kairo.intent.*`, `kairo.tool.*`, `kairo.agent.*` 标准事件。
- **Correlation**: 确保 Request/Response 和 Chain of Thought 的事件通过 `correlationId` 和 `causationId` 关联。

### 1.3 工具链路增强
- **Handle 透传**: 确保 Tool Call 参数中的 Vault Handle 能被正确传递给底层实现。
- **Result 封装**: 工具执行结果统一封装，包含 status, data, error。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 Standard Events
- `kairo.intent.started`: `{ intentId, query, context }`
- `kairo.intent.ended`: `{ intentId, result, summary }`
- `kairo.tool.invoke`: `{ toolCallId, name, args }`
- `kairo.tool.result`: `{ toolCallId, result, isError }`
- `kairo.agent.thought`: `{ content }`

### 2.2 Agent Runtime API
- `runtime.postMessage(message: UserMessage)`: 用户输入入口。
- `runtime.on(eventPattern, handler)`: 订阅运行时事件。

## 3. 模块交互 (Module Interactions)

### 3.1 完整任务闭环
1. **User Input** -> EventBus (`kairo.user.message`)
2. **AgentRuntime** 订阅消息 -> Trigger Recall -> Context Assembly.
3. **LLM Inference** -> Generate Thought & Tool Call.
4. **AgentRuntime** 发布 `kairo.tool.invoke`.
5. **ToolPlugin** 订阅 invoke -> Execute -> 发布 `kairo.tool.result`.
6. **AgentRuntime** 接收 result -> Next Inference Loop.
7. Task Complete -> Memorize -> Reply User.

## 4. 数据模型 (Data Models)

### 4.1 KairoEvent
```typescript
interface KairoEvent<T> {
  id: string;
  type: string;
  source: string;
  time: string;
  data: T;
  correlationId?: string;
  causationId?: string;
}
```

## 5. 异常处理 (Error Handling)
- **工具执行失败**: 捕获 Tool Error，作为 `kairo.tool.result` (isError=true) 返回给 Agent，让 Agent 决定重试或报错。
- **循环检测**: 防止 Agent 陷入死循环（如反复调用同一失败工具），设置最大 Loop 次数。

## 6. 测试策略 (Testing Strategy)
- **Loop Test**: 模拟工具返回特定结果，验证 Agent 的多步推理逻辑。
- **Event Trace**: 验证生成的事件流是否完整，Id 关联是否正确。
- **Handle Safety**: 验证工具调用日志中不出现明文敏感数据。
