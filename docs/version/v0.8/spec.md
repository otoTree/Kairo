# v0.8 Technical Specification: Interaction & Collaboration

## 1. 核心功能规范 (Core Features)

### 1.1 Server Bridge
- **WebSocket Gateway**: 将 EventBus 暴露给外部 UI/Client。
- **Subscription**: 前端通过 WS 订阅感兴趣的 Topic (如 `agent.thought`, `tool.result`)。
- **Action Dispatch**: 前端通过 WS 发送 User Action 到 Kernel。

### 1.2 协作原语 (Collaboration Primitives)
- **Spaces**: 多人/多 Agent 共享的上下文空间。
- **Windows**: 虚拟窗口管理，用于 UI 呈现 Agent 输出的富媒体内容。
- **Cursors**: 实时同步协作光标/状态。

### 1.3 交互权限 (Interaction Permissions)
- **Token Scope**: WS 连接 Token 限制可订阅的 Topic 和可执行的 Action。
- **Audit**: 记录来自 UI 的所有操作。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 WebSocket Protocol
- Client -> Server:
  - `{"type": "subscribe", "topic": "agent.*"}`
  - `{"type": "action", "action": "user.message", "data": "..."}`
- Server -> Client:
  - `{"type": "event", "event": KairoEvent}`

### 2.2 Collaboration Methods
- `space.create(name: string): string`
- `space.join(spaceId: string, userId: string): void`
- `window.open(url: string, options: WindowOptions): string`

## 3. 模块交互 (Module Interactions)

### 3.1 UI 交互流程
1. User 在 Web UI 输入消息。
2. UI 通过 WS 发送 Action。
3. Server Bridge 接收 Action，转换为 EventBus 事件 `kairo.user.message`。
4. Agent 收到消息，处理并回复。
5. Agent 发布 `kairo.agent.thought` / `kairo.agent.message`。
6. Server Bridge 转发事件给 UI。
7. UI 渲染回复。

## 4. 数据模型 (Data Models)

### 4.1 WindowState
```typescript
interface WindowState {
  id: string;
  title: string;
  url: string;
  geometry: { x, y, w, h };
  visible: boolean;
}
```

## 5. 异常处理 (Error Handling)
- **WS Disconnect**: 自动重连，补发丢失期间的事件（基于 Event ID）。
- **Rate Limit**: 限制单个 Client 的 Action 频率。

## 6. 测试策略 (Testing Strategy)
- **Latency Test**: 测量端到端（UI -> Kernel -> UI）的交互延迟。
- **Multi-Client Sync**: 开启多个 Browser Tab，验证状态同步一致性。
