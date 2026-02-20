# [DEPRECATED] Kairo AgentOS MVP v0.1

> **NOTICE**: This document is deprecated. Please refer to [agentos-mvp.md](./agentos-mvp.md) for the latest consolidated specification.

# Kairo AgentOS MVP v0.1（OS 视角最小可行内核）

## 1. 目标与边界（Goal & Non-Goals）

### 1.1 目标（Goal）
把 Kairo 从“可运行 Agent 的应用”推进到“可编排系统资源的 AgentOS 内核”，并且立刻能支撑真实工作负载：**与任意外部二进制进程进行全双工通信、可观测、可取消**。

该 MVP 只解决四类 Kernel 级系统原语：
- **Process IO 一等公民**：stdin 写入、stdout/stderr 订阅、退出与状态（PTY 可选）
- **IPC 主动推送**：落实 `EVENT/STREAM_CHUNK` 的内核侧推送语义
- **事件序列语义**：最小的 correlation/causation 贯通 + intent 边界 + 取消事件
- **权限闭环（最小）**：让 manifest permissions 能影响 sandbox/enforcement 路径（先做 deny-by-default 的最小链路）

### 1.2 非目标（Non-Goals）
以下不进入 v0.1（可作为 v0.2+）：
- 设备 claim/release/统一 streaming（HAL 生命周期完整化）
- 完整的能力协商 / schema introspection（`kernel.introspect` 等）
- 全量的长期可恢复会话模型（Durability & Recovery 的完整落地）
- 分发、校验、升级、回滚等 Artifact 生命周期

## 2. 现状基线（What Exists Today）

### 2.1 IPC（Unix Socket + MsgPack 帧）
- 协议编码与 framing：[protocol.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/protocol.ts)
- 服务器端（当前仅 REQUEST→RESPONSE）：[ipc-server.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts)
- 客户端（当前仅处理 RESPONSE）：[ipc-client.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-client.ts)

### 2.2 Process 管理（可 spawn/kill/pause/resume，但 IO 未对外暴露）
- ProcessManager：[process-manager.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/process-manager.ts)

### 2.3 事件总线（已有 correlation/causation 字段）
- 事件类型与接口：[events/types.ts](file:///Users/hjr/Desktop/Kairo/src/domains/events/types.ts)
- InMemory 实现（含 replay/store append）：[in-memory-bus.ts](file:///Users/hjr/Desktop/Kairo/src/domains/events/in-memory-bus.ts)

### 2.4 Sandbox（限制网络/文件等，具备较强的“强制执行”能力）
- 运行时配置与校验：[sandbox-config.ts](file:///Users/hjr/Desktop/Kairo/src/domains/sandbox/sandbox-config.ts)

### 2.5 二进制技能运行入口（注入 IPC socket 环境变量）
- BinaryRunner：[binary-runner.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/binary-runner.ts)

## 3. OS 视角的 MVP 定义（Kernel Primitives）

本节按“操作系统”的抽象来定义 v0.1：Kernel 暴露稳定原语，上层（Agent/Skills/UI）只做编排，不绑死实现细节。

### 3.1 原语 1：ProcessSession（进程会话）
Kernel 必须把“进程”提升为可查询、可观测、可关联的资源对象，而不仅是一次 spawn。

最小会话视图（示例）：
```ts
type ProcessSession = {
  id: string;              // Kairo 侧稳定 ID（由调用方提供或由内核生成）
  pid: number;
  argv: string[];
  cwd?: string;
  startedAt: string;       // ISO time
  exitedAt?: string;       // ISO time
  exitCode?: number;
  status: "running" | "exited" | "killed";
};
```

必需语义：
- **一切 IO/退出都事件化**（见 3.3、3.4），而不是靠轮询
- **可关联**：stdout/stderr/exit 事件要能回溯到发起者的 intent（见 3.5）

### 3.2 原语 2：Stdio IO（stdin 写入 / stdout&stderr 订阅）
目标是覆盖“任意二进制程序”的最小交互面（FFmpeg、编译器、渲染器、CLI 工具）。

内核必须提供：
- **stdin.write**：写入 string 或 bytes（bytes 用 base64 表达）
- **stdout/stderr subscribe**：至少支持两种模式之一
  - `chunk`：按字节分片（最通用）
  - `line`：按行分割（便于解析进度/日志）
- **backpressure**：对大输出有明确策略（限速/截断/落盘，至少先做到限速+截断）

PTY（可选但强烈建议）：
- 交互式 TUI/REPL 通常需要 PTY 才能获得一致行为（echo、行编辑、颜色控制等）
- v0.1 可以把 PTY 作为“可选能力”，不阻塞最小闭环

### 3.3 原语 3：Kernel IPC Push（EVENT / STREAM_CHUNK）
当前协议已定义 `PacketType.EVENT` 与 `PacketType.STREAM_CHUNK`，但服务器端未实现推送语义。

v0.1 的最小要求：
- IPCServer 能向连接的客户端写出 EVENT/STREAM_CHUNK
- IPCClient 能接收并分发 EVENT/STREAM_CHUNK（至少提供回调或事件 emitter）
- Kernel 对“输出/退出”使用 push，而不是让客户端轮询

推荐的最小路由策略（无需完整订阅系统）：
- **owner-only 推送**：哪个 socket 发起 `process.spawn`，该进程的 stdout/stderr/exit 只推送给该 socket
- 可选：提供 `process.attach` 让其他客户端加入（v0.2+）

### 3.4 原语 4：事件化的进程观测（Process Observability）
为避免 “stdout 太大把数据库/事件总线打爆”，v0.1 把“进程输出”拆成两条链路：

- **IPC 流式输出（实时）**：用 `STREAM_CHUNK` 推送给 owner 客户端，用于 UI 展示/解析进度
- **EventBus 结构化事件（可持久化）**：只存“低频、结构化、可回放”的事件
  - 例：`kairo.process.spawned`、`kairo.process.exited`、`kairo.process.progress`（由 wrapper/adapter 解析产生）

建议事件类型（示例）：
- `kairo.process.spawned`
- `kairo.process.exited`
- `kairo.process.canceled`
- `kairo.process.progress`（可选，通常由 L1 wrapper 生成）

### 3.5 原语 5：事件序列语义（Sequencing）
v0.1 不引入独立的 Job/Task 状态机，但需要最小“序列语义”让事件能串成一次行动。

v0.1 约定（最小）：
- **correlationId**：贯穿一次意图（intent）下的所有事件与 IPC 请求
- **causationId**：表示“由哪个事件触发”
- **intent 边界**（建议）：通过两类事件明确开始/结束
  - `kairo.intent.started`
  - `kairo.intent.ended`

实践建议：
- IPC request 增加可选 `correlationId/causationId` 字段，内核在发布 EventBus 事件时原样带上
- Process 事件（spawned/exited/canceled）必须带 correlationId（否则上层无法组装“经历”）

### 3.6 原语 6：权限闭环（最小可用）
v0.1 的安全目标是“能强制执行”，而不是“权限体系设计完美”。

最小闭环定义：
- Skill manifest 能声明 permissions：[manifest.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/manifest.ts)
- BinaryRunner/ProcessManager 在 spawn 时把 permissions 映射为 sandbox 配置（deny-by-default）
- Kernel 对 IPC method 做最小鉴权：至少把“可控制的进程范围”限制为 caller 自己创建的进程（避免跨进程越权）

v0.1 建议的默认策略：
- 未声明网络权限：默认禁止出网（或仅允许 `localhost`，取决于 sandbox 可用性）
- 文件写：只允许 workspace/临时目录（由系统配置决定）
- 设备：v0.1 可先禁止（直到 device.claim/release 落地）

## 4. v0.1 IPC API（建议最小集合）

当前已存在：
- `system.get_metrics`
- `process.spawn`
- `process.kill` / `process.pause` / `process.resume`
- `device.list`

v0.1 建议新增（最小闭环必需）：
- `process.stdin.write`
- `process.wait`
- `process.status`

可选（按需要）：
- `process.signal`（比 kill/pause/resume 更通用）
- `process.attach`（允许非 owner 订阅输出）
- `kernel.ping`（健康检查）

## 5. v0.1 IPC Push Payload（建议结构）

### 5.1 EVENT（结构化、低频）
```ts
type KernelIpcEvent = {
  type: string;                 // 例如 "kairo.process.exited"
  time: string;                 // ISO
  data: any;
  correlationId?: string;
  causationId?: string;
};
```

### 5.2 STREAM_CHUNK（高频、分片）
```ts
type KernelIpcStreamChunk = {
  stream: "stdout" | "stderr";
  processId: string;
  seq: number;                  // 单进程单流递增
  encoding: "utf8" | "base64";
  chunk: string;                // utf8 文本或 base64 bytes
  truncated?: boolean;          // 当发生截断/限速时标记
  correlationId?: string;
};
```

最小 backpressure 约束（建议）：
- 设定 `maxChunkBytes`（例如 16KB）
- 设定 `maxBytesPerSecond`（例如 256KB/s/进程/流）
- 超限时：截断并发一个 `EVENT`（例如 `kairo.process.output.throttled`），避免 UI 静默“卡住”

## 6. 兼容性分级与 v0.1 推荐落地路径

参考：[kernel-ipc-spec.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/kernel-ipc-spec.md) 中的 L0/L1/L2。

v0.1 推荐优先打通：
- **L0（参数+文件）**：立即可用，但弱实时
- **L1（Wrapper/Sidecar）**：用 v0.1 的 process IO + IPC push 实现“完全通信”（推荐用于 FFmpeg/CAD）

L2（原生 IPC）可在 v0.2+ 推进（需要更完整的协商与 schema/鉴权）。

## 7. 验收清单（Acceptance Checklist）

v0.1 完成标准（可用自动化测试/集成测试验证）：
- 启动一个短命令（例如 `echo`），能收到 `spawned` 与 `exited`（含 exitCode）
- 启动一个会输出多行的命令（例如 `yes | head -n 1000`），stdout 能以 STREAM_CHUNK 持续到达且不 OOM
- 启动一个需要 stdin 的命令（例如 `cat`），`process.stdin.write` 能把输入写入并收到回显
- `process.wait` 可等待退出并返回一致的 exitCode
- 取消语义：触发 `kairo.intent.cancel`（或等价）能传播到进程终止，并产生 `canceled/exited`
- 权限最小闭环：未声明网络权限的二进制无法出网（若 sandbox 在目标平台可用）

## 8. 与代码的对齐（Where It Fits）

v0.1 的实现落点应集中在 Kernel 域，避免跨域耦合：
- IPC push：扩展 [ipc-server.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts) 与 [ipc-client.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-client.ts)
- Process IO：在 [process-manager.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/process-manager.ts) 之上补齐会话、stdin 写入、stdout/stderr reader 与节流
- 结构化事件：使用 [InMemoryGlobalBus](file:///Users/hjr/Desktop/Kairo/src/domains/events/in-memory-bus.ts) 发布 `kairo.process.*` 事件，并只持久化低频结构化事件
- 权限闭环：从 [manifest.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/manifest.ts) 读取 permissions，在 spawn 时映射到 sandbox config（[sandbox-config.ts](file:///Users/hjr/Desktop/Kairo/src/domains/sandbox/sandbox-config.ts)）

## 9. Agent 应该做什么（User-space Orchestrator Responsibilities）

从操作系统视角，Agent 属于 user space 的“事件驱动执行进程”：它不实现内核原语，不维护复杂的意图状态机；它只做一件事：**持续消费事件、理解事件（系统语言 + 用户语言）、产出下一步动作事件，并通过工具/IPC 驱动 Kernel/Skills 干活**。

### 9.1 角色定位（Agent vs Kernel）
- Kernel：提供稳定系统原语（Process/IPC/Event/Sandbox），负责强制执行与资源治理
- Agent：负责理解与决策（理解输入、选择工具、拼装参数、追踪结果），通过事件与工具/IPC 使用 Kernel 原语

约束：
- Agent 不直接 new/调用 Kernel 内部对象；通过 EventBus/IPC/Tool 接口交互
- Agent 不把高频 stdout/stderr 全量写入长期记忆；只保留结构化摘要/关键里程碑

### 9.2 v0.1 必须具备的最小职责

1) 事件消费与理解（Read）
- 消费三类输入事件：用户输入、系统事件、工具结果事件
- 同时“读懂两种语言”：
  - 用户语言：`kairo.agent.{id}.message` 中的自然语言文本
  - 系统语言：`kairo.system.>`、`kairo.process.*`、`kairo.tool.result` 等结构化事件（类型 + data）

2) 产出动作与推进（Act）
- 将“下一步要做什么”表达为事件（例如 `kairo.agent.action`），而不是靠内部状态机
- 通过工具/IPC 触发系统调用（spawn 进程、写 stdin、等待退出、查询状态）
- 以 `kairo.tool.result` 作为推进下一步的主要触发器

3) 输出收敛与可观测（Summarize）
- 把高频输出留在实时链路（STREAM_CHUNK），只把低频关键里程碑事件化
- 将“系统输出”转换为稳定的、可复用的结构化结果（例如产物路径、成功/失败原因、关键指标）

4) 取消与清理（Cancel & Cleanup）
- 当收到取消相关事件/指令时，传播到 Kernel（终止/信号进程、停止订阅、释放资源）

5) 权限意识（最小闭环的使用方）
- 在选择运行形态/工具前检查 skill manifest permissions（以及系统策略）
- 当权限不足时优先降级策略（例如从 L1 降到 L0、或改为仅处理本地文件）

### 9.3 事件契约（Agent 需要消费/产出什么）

Agent 需要消费的事件（最小集合）：
- 用户输入：`kairo.user.message`（由 orchestrator 路由到 `kairo.agent.{id}.message`）
- 系统/Kernel 事件：`kairo.system.>`（如电量、设备连接等）以及 `kairo.process.*`（spawned/exited/canceled）
- 工具执行结果：`kairo.tool.result`

Agent 需要产出的事件（最小集合）：
- `kairo.agent.thought` / `kairo.agent.action`（现有 [AgentRuntime](file:///Users/hjr/Desktop/Kairo/src/domains/agent/runtime.ts) 已发布）
- 可选：`kairo.agent.note`（将关键信息写入可回放的摘要事件）
- 可选：`kairo.process.progress`（通常由 L1 wrapper 生成）

关联规则（建议但不要求“意图状态机”）：
- 使用 correlationId 把一次“工具调用 → 结果 → 下一步动作”串起来（或复用现有的请求相关字段）
- 当一个动作由某个事件直接触发时（例如 tool result → 下一步 action），写入 causationId，便于回放与调试

### 9.4 调用接口（Agent 如何驱动 Kernel）

v0.1 推荐以“工具化系统调用”为主，保持 AgentRuntime 的抽象稳定：
- AgentRuntime 通过工具接口发起系统调用，并通过 EventBus 接收结果与系统事件
- KernelPlugin 已注册了终端类系统工具作为范例：[kernel.plugin.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/kernel.plugin.ts)

与当前实现对齐：
- Agent 运行时是事件驱动循环，订阅 `kairo.tool.result`、`kairo.agent.{id}.message`、`kairo.system.>`：[runtime.ts](file:///Users/hjr/Desktop/Kairo/src/domains/agent/runtime.ts)
- orchestrator（AgentPlugin）负责将用户消息路由给具体 agent：[agent.plugin.ts](file:///Users/hjr/Desktop/Kairo/src/domains/agent/agent.plugin.ts)

### 9.5 L1 Wrapper 的职责边界（Agent 侧的“驱动/适配器”）

对不可修改的二进制（FFmpeg/CAD），“完全通信”通常依赖 L1：
- wrapper 负责托管目标程序、解析其输出并生成结构化事件（progress/error class）
- Agent 负责选择 wrapper、传参、订阅 wrapper 的进度与结果、决定下一步编排

v0.1 建议把“解析规则”放在 wrapper/skill 内，而不是写死在 Agent prompt 里，以减少不确定性与不可测试逻辑。
