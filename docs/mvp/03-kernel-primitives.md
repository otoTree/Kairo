# Kernel Primitives（IPC + ProcessSession + Observability）规格说明（MVP v0.1）

## 1. 目标

Kernel 对上层（Agent/Skills/UI）暴露稳定系统原语，避免上层绑死实现细节。v0.1 最小闭环聚焦：
- ProcessSession：进程会话对象（可查询、可观测、可关联）
- Stdio IO：stdin.write + stdout/stderr 流式订阅（chunk/line 至少一种）
- IPC Push：内核主动推送 EVENT/STREAM_CHUNK
- 结构化事件：低频、可持久化（spawned/exited/canceled 等）

## 2. 范围与非目标

进入 v0.1：
- `process.spawn/kill/pause/resume` 继续保留
- 新增 `process.stdin.write`、`process.wait`、`process.status`
- owner-only 推送：哪个 IPC socket 发起 spawn，仅推送给该连接（v0.1 默认）
- backpressure：至少“限速 + 截断 + 事件提示”

不进入 v0.1：
- `process.attach` 多连接订阅（v0.2+）
- 完整 PTY 能力协商/切换（可作为可选能力）
- 完整 tracing/span 模型（先使用 correlation/causation）

## 3. 现状对齐（代码基线）

- IPC 协议与 framing：[protocol.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/protocol.ts)
- IPC Server：[ipc-server.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts)
- IPC Client：[ipc-client.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-client.ts)
- Process 管理：[process-manager.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/process-manager.ts)
- Kernel 插件装配：[kernel.plugin.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/kernel.plugin.ts)
- 事件桥接（设备/指标）：[bridge.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/bridge.ts)

参考背景：
- [kernel-ipc-spec.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/kernel-ipc-spec.md)
- [agentos-mvp-v0.1.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/agentos-mvp-v0.1.md)

## 4. 数据模型（稳定）

### 4.1 ProcessSession（最小视图）

```ts
type ProcessSession = {
  id: string
  pid: number
  argv: string[]
  cwd?: string
  startedAt: string
  exitedAt?: string
  exitCode?: number
  status: "running" | "exited" | "killed"
}
```

约束：
- `id` 在 Kernel 内部必须稳定（可由调用方提供或内核生成）
- stdout/stderr/exit 必须能回溯到该 `id`

## 5. IPC 协议与语义（v0.1）

### 5.1 Transport

- Unix Domain Socket（默认）：`/tmp/kairo-kernel.sock`
- 二进制技能通过环境变量读取：`KAIRO_IPC_SOCKET`

### 5.2 PacketType（必须）

协议类型必须支持：
- REQUEST / RESPONSE（现有）
- EVENT / STREAM_CHUNK（v0.1 落地推送）

### 5.3 RPC 方法（最小集合）

现有方法（保留）：
- `system.get_metrics`
- `process.spawn`
- `process.kill` / `process.pause` / `process.resume`
- `device.list`

v0.1 必增：
- `process.stdin.write`
- `process.wait`
- `process.status`

方法行为约束（跨方法通用）：
- 必须支持携带 `correlationId/causationId`（可选字段，但内核要原样转发到后续事件）
- 必须进行最小鉴权：caller 只能操作自己创建的 processId（见安全 spec）

## 6. IPC Push Payload（稳定）

### 6.1 EVENT（低频、结构化）

```ts
type KernelIpcEvent = {
  type: string
  time: string
  data: unknown
  correlationId?: string
  causationId?: string
}
```

v0.1 最小事件类型集（结构化、可持久化）：
- `kairo.process.spawned`
- `kairo.process.exited`
- `kairo.process.canceled`
- `kairo.process.output.throttled`（当发生限速/截断时）

### 6.2 STREAM_CHUNK（高频、分片）

```ts
type KernelIpcStreamChunk = {
  stream: "stdout" | "stderr"
  processId: string
  seq: number
  encoding: "utf8" | "base64"
  chunk: string
  truncated?: boolean
  correlationId?: string
}
```

backpressure 最小约束（必须显式实现并可配置）：
- `maxChunkBytes`：单 chunk 最大字节数（例如 16KB）
- `maxBytesPerSecond`：单进程单流吞吐上限（例如 256KB/s）
- 超限策略：`truncated=true` + 发送一次 `kairo.process.output.throttled` EVENT（避免 UI 静默卡死）

## 7. 结构化事件 vs 实时流的分工（必须）

为避免 stdout/stderr 把 EventStore/DB 打爆，v0.1 必须分离两条链路：
- 实时链路：stdout/stderr 走 STREAM_CHUNK，仅发送给 owner socket
- 结构化链路：只把低频里程碑写入 EventBus/EventStore（spawned/exited/canceled/progress 等）

## 8. 依赖关系

Kernel 依赖：
- Eventing（发布结构化事件）
- Sandbox（spawn 时执行权限/隔离策略）
- DeviceRegistry/SystemMonitor（用于桥接系统事件与 device.list）

Kernel 被依赖：
- Skills Runtime（运行二进制/sidecar 时复用进程原语）
- Server/Agent（通过 IPC/事件驱动编排）

## 9. 验收标准（v0.1）

- 启动短命令（如 `echo`）可收到 `kairo.process.spawned` 与 `kairo.process.exited`（含 exitCode）
- 启动会输出大量内容的命令（如 `yes | head -n 1000`）stdout 通过 STREAM_CHUNK 持续到达且不会 OOM
- `process.stdin.write` 对 `cat` 生效，可收到回显
- `process.wait` 可等待退出并返回一致 exitCode
- 取消事件能传播到进程终止，并产生 canceled/exited

