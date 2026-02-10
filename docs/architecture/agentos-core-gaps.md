# Kairo AgentOS 底层能力缺失清单 (Core Gaps)

## 1. 目的 (Purpose)
本清单用于把 Kairo 从“可运行 Agent 的应用”推进为“可编排系统资源的 AgentOS”。重点不在上层对话与 UI，而在 **Kernel 级系统原语**：进程、IO、设备、安全、状态、可观测性与协议演进。

## 2. 当前已有基础 (What Exists Today)
以下能力在当前代码库中已经有雏形或部分实现，可作为 AgentOS 底座继续扩展：
- **Kernel IPC**：Unix Socket + MsgPack 帧协议，提供基本 RPC 入口  
  - 协议：[protocol.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/protocol.ts)  
  - 服务端：[ipc-server.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts)  
  - 客户端：[ipc-client.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-client.ts)
- **Process 管理**：可 spawn/kill/pause/resume，支持基础沙箱/资源限制包装  
  - [process-manager.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/process-manager.ts)
- **事件总线**：通配订阅、request/response、replay、持久化存储（内存缓冲 + DB）  
  - [events](file:///Users/hjr/Desktop/Kairo/src/domains/events)
- **Sandbox**：网络与文件系统约束、Unix socket 控制、跨平台实现（macOS/Linux）  
  - [sandbox-manager.ts](file:///Users/hjr/Desktop/Kairo/src/domains/sandbox/sandbox-manager.ts)  
  - [sandbox-config.ts](file:///Users/hjr/Desktop/Kairo/src/domains/sandbox/sandbox-config.ts)
- **设备登记**：DeviceRegistry/Monitor + 部分驱动（serial/gpio），并通过 KernelEventBridge 事件化  
  - [device](file:///Users/hjr/Desktop/Kairo/src/domains/device)  
  - [bridge.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/bridge.ts)
- **技能形态声明**：manifest 支持 binary/wasm/container 等类型的声明结构（运行时仍未完全落地）  
  - [manifest.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/manifest.ts)

## 3. 缺失清单（按优先级）(Gap List by Priority)

### P0：进程 IO 一等公民（实现“与任意二进制完全通信”的前提）
现状：能启动与控制进程，但缺少将 stdin/stdout/stderr 作为可编排资源暴露给 Kernel/IPC/EventBus。

缺失能力：
- **stdin 写入**：支持字符串/bytes（必要时 base64）写入目标进程
- **stdout/stderr 订阅**：按 chunk/按行两种模式，支持 backpressure 与限速
- **PTY 支持**：交互式程序（REPL/TUI）需要 PTY 才能“像人在终端里使用”
- **退出与状态**：wait/exitCode、运行状态、启动时间、命令行、环境变量摘要
- **大输出与长时任务**：分片、截断策略、落盘策略、以及事件化（对 UI/Agent 友好）

与现有代码的关系：
- Protocol 已预留 `EVENT/STREAM_CHUNK`，但 IPCServer 未使用：[protocol.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/protocol.ts#L6-L13) / [ipc-server.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts#L76-L109)
- ProcessManager 在 spawn 时已设置 pipe，但没有对外 API：[process-manager.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/process-manager.ts#L39-L49)

### P0：事件序列语义（Event-Sourced Sequencing）
约束：本 AgentOS 采用“完全事件驱动”的运行模型，不引入独立的 Job/Task 状态机；一切都由事件在时间维度形成序列（像人一样通过经历来推进）。

在这种模型下，缺失点不再是“任务模型”，而是事件流的关键语义与可用性：
- **可追踪链路**：跨 EventBus、IPC、Process 的一致 correlation/causation 习惯用法（线程/上下文连续性）
- **意图与边界**：标识“一个连续意图/一段行动”的开始与结束（否则只是一串点状事件）
- **取消语义**：用事件表达中断/撤销（例如 `kairo.intent.cancel`）并能传播到进程与适配器
- **压缩与摘要**：长期事件流需要 compaction（摘要事件）与可回放的视图（projection）
- **幂等与去重**：在重放/重连/重复投递场景下的去重策略（尤其是副作用事件）

### P0：权限模型与强制执行（Authorization + Enforcement）
现状：Sandbox 能执行“环境层面”的网络/文件限制；Skills manifest 也能声明 permissions，但未形成端到端授权链路。

缺失能力：
- **声明 → 授权 → 强制** 的闭环：Skill/Agent 请求权限、系统批准、执行时强制
- **粒度**：按 agent/skill/process/session 区分权限与审计
- **IPC 方法级鉴权**：不同 caller 对 kernel methods 的访问控制
- **设备权限联动**：device.claim/read/write 与 sandbox 规则一致
- **审计日志**：可追踪“谁在何时因何目的访问了什么资源”

与现有代码的关系：
- Sandbox 规则能力较完整，但需要一个上层权限分发与绑定机制：[sandbox-config.ts](file:///Users/hjr/Desktop/Kairo/src/domains/sandbox/sandbox-config.ts#L44-L92)
- Skills manifest 权限结构已存在但未被执行路径消费：[manifest.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/manifest.ts#L15-L36)

### P1：Kernel IPC 能力集扩展与自描述（Introspection & Negotiation）
现状：IPC methods 集合较少且固定；协议只有硬版本号，缺少能力协商与 schema 暴露。

缺失能力：
- **kernel.introspect**：列出支持的 methods、版本、schema（JSON Schema/等价结构）
- **feature negotiation**：支持扩展能力协商（例如是否支持 STREAM_CHUNK/PTY）
- **结构化错误**：error code/message/details/retryable
- **服务发现**：多服务/插件在 kernel 注册方法的统一入口

### P1：设备（HAL）生命周期完整化
现状：DeviceRegistry/Monitor 已有“登记与事件”，但缺少“占用、并发、流式 IO、失败恢复”。

缺失能力：
- **device.claim/release**：独占与共享规则
- **device.stream**：串口/摄像头/音频等的统一 streaming 语义
- **并发控制**：同一设备的多任务争用解决
- **热插拔恢复**：重连、资源回收、任务失败语义
- **统一 schema**：设备类型能力矩阵（serial/gpio/camera/audio 等）

### P1：可观测性（Observability）系统化
现状：有事件总线与部分系统指标，但缺少跨层关联与运行时诊断闭环。

缺失能力：
- **Tracing/Correlation**：贯穿 EventBus、IPC、Process、ToolCall 的 traceId/spanId
- **结构化日志**：统一字段（component/agentId/intentId/processId）
- **进程输出事件化**：stdout/stderr/progress 归一为可订阅事件
- **诊断快照**：一键导出（近期事件、进程列表、关键配置、违规记录）

### P2：状态与恢复（Durability & Recovery）
现状：事件可写 DB，但任务、进程会话、资源锁等并没有“可恢复的系统模型”。

缺失能力：
- **持久化实体**：Artifact、ProcessSession、DeviceClaim、EventStream/View（投影/摘要）
- **重启恢复**：恢复正在进行的会话/意图链路，或明确失败并补偿
- **迁移策略**：数据模型/协议升级的版本迁移

### P2：技能分发与运行形态（Artifacts Lifecycle）
现状：manifest 支持 binary/wasm/container，但缺少完整“下载/校验/选择/升级/回滚/隔离”链路。

缺失能力：
- **校验**：hash/签名/可信来源
- **多平台选择**：darwin-arm64/linux-x64 等自动选择
- **升级回滚**：版本 pin、灰度、回滚策略
- **运行隔离**：依赖隔离、动态库/FFI/Wasm/container 的统一治理

## 4. 与“外部程序完全通信”的集成分级（Compatibility Levels）
这部分用于落地 FFmpeg/CAD 等真实工作负载：
- **L0（参数+文件）**：仅靠 argv + workspace 文件交换；实现成本低，但实时性弱
- **L1（Wrapper/Sidecar）**：用 wrapper 托管目标程序并做 IO/进度解析，再回传给 Kairo；适合现成二进制（推荐）
- **L2（原生 IPC 集成）**：目标程序直接实现 Kairo IPCClient；适合自研算法/可控二进制

L1/L2 的可行性关键依赖：P0 的“进程 IO 原语”与“IPC 事件/流推送”。

## 5. 最小可用 AgentOS 内核原语 v0.1（建议收敛目标）
如果要尽快进入工程落地，建议 v0.1 只做四件事：
- **Process IO**：stdin 写入 + stdout/stderr 订阅 + exit/status（含 PTY 可选）
- **IPC 推送**：实现 EVENT/STREAM_CHUNK 的服务端推送语义
- **事件序列语义**：统一 correlation/causation + intent 边界 + 取消事件 + 投影/摘要
- **权限闭环**：把 skill manifest permissions 与 sandbox enforcement 串起来（最小可用）
