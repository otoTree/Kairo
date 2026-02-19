# Kairo AgentOS 功能演进 — 技术规格 (Spec)

> 版本：v0.2
> 日期：2026-02-20

---

## 1. Process IO 原语

### 1.1 IPC 方法扩展

在 `src/domains/kernel/ipc-server.ts` 中新增以下方法：

```typescript
// 向子进程 stdin 写入数据
"process.stdin.write": {
  params: { pid: number, data: string | Buffer },
  returns: { bytesWritten: number }
}

// 订阅子进程 stdout/stderr
"process.stdout.subscribe": {
  params: { pid: number, mode: "chunk" | "line", stream: "stdout" | "stderr" | "both" },
  returns: { subscriptionId: string }
}

// 取消订阅
"process.stdout.unsubscribe": {
  params: { subscriptionId: string },
  returns: { ok: boolean }
}

// 等待进程退出
"process.wait": {
  params: { pid: number, timeoutMs?: number },
  returns: { exitCode: number, signal?: string }
}

// 查询进程状态
"process.status": {
  params: { pid: number },
  returns: { state: "running" | "stopped" | "exited", exitCode?: number }
}
```

### 1.2 Backpressure 机制

- 每个订阅维护一个 Ring Buffer（默认 1MB）
- 当 buffer 满时，丢弃最旧的 chunk 并发送 `overflow` 警告事件
- 客户端可通过 `process.stdout.subscribe` 的 `bufferSize` 参数自定义

### 1.3 实现位置

- `src/domains/kernel/process-manager.ts` — 扩展 ProcessHandle，添加 stdin/stdout 管道
- `src/domains/kernel/ipc-server.ts` — 注册新方法
- `src/domains/kernel/stream-subscription.ts` — 新文件，管理流订阅

---

## 2. IPC 服务端推送

### 2.1 帧协议扩展

当前 IPC 协议仅支持 REQUEST/RESPONSE。新增：

```
帧类型:
  0x01 = REQUEST
  0x02 = RESPONSE
  0x03 = EVENT      (新增)
  0x04 = STREAM_CHUNK (新增)
```

### 2.2 EVENT 帧格式

```
{
  type: 0x03,
  topic: string,        // 事件主题，如 "kairo.agent.action"
  payload: MsgPack,     // 事件数据
  correlationId?: string,
  causationId?: string
}
```

### 2.3 STREAM_CHUNK 帧格式

```
{
  type: 0x04,
  subscriptionId: string,
  stream: "stdout" | "stderr",
  data: Buffer,
  sequence: number      // 单调递增序号，用于检测丢包
}
```

### 2.4 订阅管理

- 客户端发送 `subscribe(topic)` REQUEST，服务端返回 `subscriptionId`
- 服务端通过 EVENT 帧推送匹配的事件
- 客户端发送 `unsubscribe(subscriptionId)` 取消

### 2.5 实现位置

- `src/domains/kernel/protocol.ts` — 扩展帧类型定义
- `src/domains/kernel/ipc-server.ts` — 实现推送逻辑
- `src/domains/kernel/subscription-manager.ts` — 新文件，管理订阅状态

---

## 3. 事件序列语义

### 3.1 强制 correlationId

在 `src/domains/events/in-memory-bus.ts` 的 `publish` 方法中：

```typescript
publish(event: KairoEvent): string {
  // 自动填充缺失的 correlationId
  if (!event.correlationId) {
    event.correlationId = event.id || randomUUID();
  }
  // ...
}
```

### 3.2 取消语义

新增事件类型 `kairo.cancel`：

```typescript
interface CancelEvent extends KairoEvent {
  type: "kairo.cancel";
  data: {
    targetCorrelationId: string;  // 要取消的事件链
    reason?: string;
  }
}
```

处理逻辑：
1. Agent Runtime 收到 `kairo.cancel` 时，检查 `pendingActions` 中是否有匹配的 correlationId
2. 如果有，向对应进程发送 SIGTERM
3. 发布 `kairo.intent.cancelled` 事件

### 3.3 实现位置

- `src/domains/events/in-memory-bus.ts` — correlationId 自动填充
- `src/domains/agent/runtime.ts` — 取消处理逻辑
- `src/domains/kernel/process-manager.ts` — 进程终止

---

## 4. 权限闭环

### 4.1 Manifest → Sandbox 映射

在 `src/domains/skills/skills.plugin.ts` 的 `equipSkill` 中，当前已构建 `sandboxConfig`，但未传递给实际执行路径。

修复：将 `sandboxConfig` 注入到 `BinaryRunner.run()` 和 `SandboxManager.wrapWithSandbox()` 调用中。

### 4.2 IPC 方法级鉴权

在 `src/domains/kernel/ipc-server.ts` 中：

```typescript
// 每个连接关联一个 identity
interface IPCConnection {
  socket: Socket;
  identity?: {
    pid: number;
    skillId?: string;
    runtimeToken?: string;
  }
}

// 方法调用前检查权限
function checkPermission(conn: IPCConnection, method: string, params: any): boolean {
  // process.* 方法：只能操作自己创建的进程
  if (method.startsWith("process.")) {
    const targetPid = params.pid;
    return processManager.isOwnedBy(targetPid, conn.identity?.pid);
  }
  return true; // 其他方法暂时放行
}
```

### 4.3 实现位置

- `src/domains/skills/skills.plugin.ts` — sandboxConfig 传递
- `src/domains/kernel/ipc-server.ts` — 鉴权中间件
- `src/domains/kernel/process-manager.ts` — 进程所有权追踪

---

## 5. Agent 协作模型

### 5.1 消息传递

通过 EventBus topic 命名空间隔离：

```
kairo.agent.{agentId}.message  — 定向消息
kairo.agent.{agentId}.task     — 任务委派
kairo.agent.{agentId}.result   — 任务结果
```

### 5.2 任务委派

```typescript
interface TaskDelegation {
  parentAgentId: string;
  childAgentId: string;
  task: string;
  context: Record<string, any>;
  timeout?: number;
}
```

### 5.3 能力声明

每个 Agent 在启动时发布能力：

```typescript
bus.publish({
  type: "kairo.agent.capability",
  source: `agent:${agentId}`,
  data: {
    capabilities: ["code_review", "file_management", "web_search"],
    tools: ["kairo_terminal_exec", "run_python"]
  }
});
```

### 5.4 实现位置

- `src/domains/agent/agent.plugin.ts` — 路由增强、任务委派
- `src/domains/agent/runtime.ts` — 能力声明
- `src/domains/agent/collaboration.ts` — 新文件，协作逻辑

---

## 6. UI 交互闭环

### 6.1 KDP user_action 事件

在 `os/src/shell/river/KairoDisplay.zig` 中实现：

```zig
// 当用户点击 overlay 区域时，发送 user_action 事件
fn handlePointerClick(self: *KairoSurface, x: i32, y: i32) void {
    // 命中测试：判断点击了哪个 UI 元素
    // 通过 kairo_surface_v1.user_action 事件回传
    self.resource.sendUserAction(json_payload);
}
```

### 6.2 信号路由

TypeScript 侧在 `src/domains/ui/compositor.plugin.ts` 中：

```typescript
// 收到 KDP user_action 后，转发到 EventBus
bus.publish({
  type: "kairo.ui.signal",
  source: "kdp",
  data: { surfaceId, signalName, payload }
});
```

Agent Runtime 已订阅 `kairo.ui.signal`，会在下一个 tick 中处理。

### 6.3 实现位置

- `os/src/shell/river/KairoDisplay.zig` — 输入事件处理
- `src/domains/ui/compositor.plugin.ts` — 信号路由
- `src/domains/agent/runtime.ts` — UI 信号处理（已有基础）
