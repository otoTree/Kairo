# 全局事件总线规范 (Kairo 神经系统)

## 1. 概述 (Overview)
**全局事件总线 (Global Event Bus)** 是 Kairo 的中枢神经系统。它将取代简单的 `ObservationBus`，成为一个健壮、可扩展且具备互操作性的消息传递基础设施。其设计旨在解耦各个组件（Agent、工具、UI、插件），并支持高吞吐量的异步通信。

## 2. 目标 (Goals)
- **解耦 (Decoupling)**：发布者（如工具）和订阅者（如 Agent）无需知道对方的存在。
- **可扩展性 (Scalability)**：能够处理大量事件而不阻塞主线程（支持最终一致性）。
- **互操作性 (Interoperability)**：标准化的事件格式（符合 CloudEvents 规范），允许与外部软件或 Sidecar 集成。
- **可观测性 (Observability)**：所有系统交互都是透明且可记录的。
- **持久化 (Persistence)**：支持事件溯源 (Event Sourcing) 和重放 (Replay)，以便在任何时间点重建状态（Context）。

## 3. 架构 (Architecture)

### 3.1 事件信封 (Event Envelope - CloudEvents Compliant)
总线上的每条消息都遵循标准的信封结构。

```typescript
export interface KairoEvent<T = unknown> {
  // 事件的唯一标识符
  id: string;
  // 标准类型 URN (例如 "kairo.agent.thought", "kairo.tool.exec")
  type: string;
  // 事件来源 (例如 "agent:default", "tool:fs")
  source: string;
  // 数据规范版本
  specversion: "1.0";
  // 时间戳 (ISO 8601)
  time: string;
  // 实际负载数据
  data: T;
  // 关联 ID，用于 请求/响应 模式
  correlationId?: string;
  // 因果 ID (导致此事件发生的上一个事件 ID)
  causationId?: string;
}
```

### 3.2 核心组件 (Core Components)

1.  **EventBus Interface**：主要 API 接口。
2.  **EventStore**：事件的持久化日志（取代临时的内存 buffer）。
3.  **SubscriptionManager**：处理主题匹配和监听器分发。

### 3.3 主题层级 (Topic Hierarchy)
我们使用点分隔的主题层级进行订阅（支持通配符 `*` 和 `>`）。

- `agent.{agentId}.lifecycle` (启动, 停止)
- `agent.{agentId}.thought` (思考过程)
- `agent.{agentId}.action` (执行动作)
- `tool.{toolId}.invoke` (工具调用)
- `tool.{toolId}.result` (工具结果)
- `system.log` (系统日志)
- `system.error` (系统错误)

## 4. 接口定义 (Interfaces)

```typescript
export type EventHandler<T = any> = (event: KairoEvent<T>) => void | Promise<void>;

export interface EventBus {
  // 发布事件到总线
  publish<T>(event: Omit<KairoEvent<T>, "id" | "time" | "specversion">): Promise<string>;

  // 订阅主题模式 (例如 "agent.*.thought")
  subscribe(pattern: string, handler: EventHandler): () => void;

  // 请求/响应 模式 (封装了 publish + subscribe)
  request<T, R>(topic: string, data: T, timeout?: number): Promise<R>;
  
  // 从历史记录重放事件 (用于构建 Agent 上下文)
  replay(filter: EventFilter): Promise<KairoEvent[]>;
}

export interface EventFilter {
  fromTime?: number;
  toTime?: number;
  types?: string[];
  sources?: string[];
  limit?: number;
}
```

## 5. 实现策略 (Implementation Strategy)

### 阶段 1：内存增强版 (In-Memory Enhanced - TypeScript)
- 实现符合接口定义的 `InMemoryGlobalBus`。
- 内部使用 `RxJS` 或 `Mitt` 进行高效分发。
- 实现 `RingBufferEventStore` 来处理 `replay()` (用于上下文窗口)。

### 阶段 2：外部适配器 (External Adapters - Future)
- **Redis/NATS Adapter**：用于多进程扩展。
- **WebSocket Bridge**：用于将总线暴露给外部 UI 或 Sidecar。

## 6. 从 ObservationBus 迁移 (Migration)

现有的 `ObservationBus` 将变成 `GlobalBus` 上的一个专用 **视图 (View)** 或 **适配器 (Adapter)**。

1.  **重构**：`AgentRuntime` 将接收 `EventBus` 而不是 `ObservationBus`。
2.  **适配器**：
    ```typescript
    class LegacyObservationBusAdapter implements ObservationBus {
      constructor(private globalBus: EventBus, private agentId: string) {}
      
      publish(obs: Observation) {
        // 将旧版 Observation 映射为 KairoEvent
        this.globalBus.publish({
           type: `kairo.legacy.${obs.type}`,
           source: `agent:${this.agentId}`,
           data: obs
        });
      }
      // ... 映射 subscribe 和 snapshot
    }
    ```

## 7. 使用示例 (Example Usage)

```typescript
// 工具执行请求
bus.publish({
  type: "kairo.tool.exec",
  source: "agent:main",
  data: { tool: "readFile", args: { path: "..." } },
  correlationId: "req-123"
});

// 工具响应 (由 Tool Plugin 处理)
bus.publish({
  type: "kairo.tool.result",
  source: "tool:fs",
  data: { content: "..." },
  correlationId: "req-123" // 关联到请求 ID
});

// Agent 订阅
bus.subscribe("kairo.tool.result", (event) => {
  if (event.correlationId === myPendingRequestId) {
    // 处理结果
  }
});
```
