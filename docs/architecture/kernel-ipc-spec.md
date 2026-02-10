# Kernel IPC 与二进制通信规范 (AgentOS 底层能力)

## 1. 概述 (Overview)
Kairo 作为 AgentOS，需要一个稳定、可演进的内核通信层，用于：
- 控制与观测外部二进制进程（例如 FFmpeg、CAD 算法可执行文件、渲染器、编译器等）
- 统一硬件抽象层（HAL）与系统能力（进程、设备、系统指标）的访问方式
- 支撑上层 Agent/Skills/UI 的编排，而不让上层依赖具体实现细节

当前代码中，该通信层由 **Kernel IPC** 实现：通过 Unix Domain Socket 暴露内核 RPC（以及预留的事件/流式能力）。

相关实现入口：
- IPC 协议编码与解码：[protocol.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/protocol.ts)
- IPC 服务器（内核侧）：[ipc-server.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts)
- IPC 客户端（进程侧/适配器侧）：[ipc-client.ts](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-client.ts)
- 二进制技能注入 IPC 位置：[binary-runner.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/binary-runner.ts)

## 2. 目标 (Goals)
- **稳定性 (Stability)**：对外协议保持长期兼容；支持版本演进。
- **可组合 (Composable)**：进程/IO/设备/系统指标等能力以统一模型组合。
- **可观测 (Observable)**：关键状态变化可事件化，可回放/审计。
- **高性能 (Performance)**：二进制帧协议 + MsgPack，低开销。
- **安全性 (Security)**：支持按 Agent/Skill/Process 的权限与沙箱策略落地。

## 3. 连接与寻址 (Transport & Addressing)
### 3.1 Socket 路径
默认使用 Unix Domain Socket：
- `/tmp/kairo-kernel.sock`

内核侧默认监听该路径（可通过构造参数覆盖），见 [IPCServer](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts#L12-L20)。

### 3.2 环境变量注入
当 Kairo 启动“二进制技能”时，会注入：
- `KAIRO_IPC_SOCKET=/tmp/kairo-kernel.sock`

见 [BinaryRunner](file:///Users/hjr/Desktop/Kairo/src/domains/skills/binary-runner.ts#L13-L24)。

这使得外部进程可以在不硬编码路径的情况下，选择连接到 Kairo Kernel IPC。

## 4. 帧协议 (Framing Protocol)
IPC 使用固定头部 + MsgPack payload 的帧格式。

实现见 [Protocol.encode/decode](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/protocol.ts#L17-L61)。

### 4.1 Header（8 字节）
- Magic（2 bytes, big-endian）：`0x4B41`（ASCII "KA"）
- Version（1 byte）：当前为 `1`
- Type（1 byte）：PacketType
- Length（4 bytes, big-endian）：payload 长度（字节）

Header 固定为：

```
0               1               2               3               4               7
|   MAGIC(2)    | VERSION(1)    | TYPE(1)       | LENGTH(4)                 |
```

### 4.2 Payload（MsgPack）
payload 为 MsgPack 编码的对象（任意 map/array/scalar），由 msgpackr 进行编码/解码。

## 5. PacketType（消息类型）
定义见 [PacketType](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/protocol.ts#L6-L13)：
- `REQUEST = 0x01`：请求（RPC）
- `RESPONSE = 0x02`：响应（RPC）
- `EVENT = 0x03`：事件（预留：内核主动推送）
- `STREAM_CHUNK = 0x04`：流数据分片（预留：进程 IO/大数据流）

当前 IPCServer 的主路径只处理 REQUEST→RESPONSE（EVENT/STREAM_CHUNK 尚未使用），见 [IPCServer.processPacket](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts#L76-L109)。

## 6. RPC 语义 (Request/Response Semantics)
### 6.1 Request Payload 结构
IPCClient 在发送请求前会补齐 `id`，见 [IPCClient.request](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-client.ts#L45-L52)。

规范化请求结构：

```typescript
type KernelIpcRequest = {
  id: string;            // 请求唯一 ID，由客户端生成
  method: string;        // 方法名（命名空间点分隔）
  params?: any;          // 参数对象
};
```

### 6.2 Response Payload 结构
IPCServer 响应结构（至少包含 id，result/error 二选一），见 [IPCServer.processPacket](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts#L105-L109)。

```typescript
type KernelIpcResponse = {
  id: string;            // 与请求一致
  result: any | null;    // 成功结果
  error?: string;        // 失败原因（字符串）
};
```

### 6.3 错误模型（当前）
当前实现以字符串错误返回（`error: e.message || String(e)`），还没有错误码/分类/可恢复策略。

建议演进方向：
- `error` 结构化：`{ code, message, details?, retryable? }`
- 定义标准错误码（例如 E_INVALID_PARAMS / E_NOT_FOUND / E_PERMISSION_DENIED / E_TIMEOUT）

## 7. 当前已支持的内核方法 (Supported Methods)
当前 IPCServer 支持的方法集合较小，集中在系统指标、进程管理、设备查询：

实现见 [IPCServer.processPacket switch](file:///Users/hjr/Desktop/Kairo/src/domains/kernel/ipc-server.ts#L86-L109)。

### 7.1 system.get_metrics
- 作用：获取系统指标（CPU/内存/电池等）
- 返回：SystemMetrics

### 7.2 process.spawn
- 作用：启动进程
- params：
  - `id: string`
  - `command: string[]`（argv）
  - `options?: { cwd?: string; env?: Record<string,string>; limits?: { cpu?: number; memory?: number } }`

### 7.3 process.kill / process.pause / process.resume
- 作用：控制已登记进程
- params：
  - `id: string`

### 7.4 device.list
- 作用：列出内核已登记设备（来自 DeviceRegistry）

## 8. 与外部二进制程序“完全通信”的策略 (Compatibility & Full Duplex Integration)
外部程序（FFmpeg、CAD 算法等）大致分两类：**不可修改** 与 **可修改/可包装**。Kairo 要做到“完全通信”，需要把“进程 IO”提升为内核原语，并提供适配层。

### 8.1 兼容级别 L0：不改程序（CLI + 文件）
适用于：FFmpeg/传统命令行工具（只接受参数与文件路径）。

Kairo 的最小编排方式：
- 使用 process.spawn 启动
- 通过文件作为输入/输出交换（workspace/deliverables）

缺点：
- 无法实时观测进度（除非解析 stderr/stdout）
- 无法在运行中交互式变更参数/发送控制命令（多数 CLI 不支持）

### 8.2 兼容级别 L1：Sidecar/Wrapper（推荐用于“完全通信”）
适用于：不能改主程序，但希望强交互与可观测性。

做法：
- 写一个 wrapper 进程（可以是 TS/Rust/Python），负责：
  - 启动/托管目标二进制
  - 读写其 stdin/stdout/stderr
  - 将进度/结构化事件通过 Kernel IPC（或 EventBus）回传给 Kairo
- Kairo 只需要与 wrapper 通信，wrapper 才理解目标程序细节（例如 FFmpeg 的日志格式）

优点：
- 不需要修改目标二进制
- 可以实现实时进度、取消、分片输出、错误分类等

### 8.3 兼容级别 L2：原生集成（目标程序直接实现 IPCClient）
适用于：自研算法、可控的二进制技能、可编译的插件/服务。

做法：
- 目标程序读取 `KAIRO_IPC_SOCKET`
- 直接按本协议连接并调用内核方法（或作为长期连接的服务端/客户端）

优点：
- 协议开销低、链路最短
- 适合高频控制与状态上报

## 9. AgentOS 视角的关键缺失 (Gaps)
要支撑“任意二进制程序完全通信”，当前系统能力仍缺少以下内核原语与协议扩展。

### 9.1 进程 IO 原语缺失（最关键）
当前 ProcessManager 仅负责 spawn/kill/pause/resume（内部确实以 `stdout: 'pipe', stderr: 'pipe', stdin: 'pipe'` 启动进程），但没有：
- 统一读取 stdout/stderr 的订阅接口
- 向 stdin 写入的对外接口
- PTY 支持（交互式 TUI/REPL 程序通常需要 PTY）
- 将 IO 作为 EVENT/STREAM_CHUNK 输出给调用方

这会直接限制 FFmpeg/CAD 等程序的实时交互能力。

### 9.2 IPC 的事件推送未落地
Protocol 预留了 `EVENT` 与 `STREAM_CHUNK`，但 IPCServer 未实现。

建议最小扩展：
- 进程退出：`process.exited`（EVENT）
- 输出分片：`process.stdout.chunk` / `process.stderr.chunk`（STREAM_CHUNK 或 EVENT）
- 结构化进度：例如 `ffmpeg.progress`（EVENT，通常由 adapter 解析产生）

### 9.3 事件序列语义缺失
约束：该 AgentOS 采取“完全基于事件”的运行模型，不依赖独立的 Job/Task 状态机；系统在时间维度上天然形成序列。

在这种模型下，IPC/事件层仍缺少关键语义来支撑“可编排、可回放、可恢复”的连续行动：
- **链路关联**：跨 IPC 与 EventBus 的 correlation/causation 统一用法（让事件串成“经历”）
- **意图边界**：标识一个连续意图/一段行动的开始与结束（否则只是点状事件）
- **取消语义**：用事件表达中断/撤销，并能传播到进程与适配器
- **幂等与去重**：在重放/重连/重复投递场景下避免重复副作用
- **压缩与投影**：长期事件流的摘要（compaction）与可回放视图（projection）

### 9.4 权限与安全边界缺失
当前 Sandbox/limits 已部分接入，但仍缺：
- 按 agent/skill/process 的权限模型（FS/Net/Device）
- IPC method 的鉴权与隔离（至少在本地多进程场景）

### 9.5 协议演进机制缺失
目前只有 `VERSION=1` 的硬校验，没有：
- feature negotiation（能力协商）
- 服务发现（列出可用 methods 与 schema）
- 向后兼容策略（例如多版本共存）

## 10. 建议的协议扩展（Roadmap）
以下为与现有结构最贴近的演进方向（保持内核原语稳定，上层用适配器实现复杂逻辑）。

### 10.1 Process IO 与会话
新增 methods（示例）：
- `process.attach`：返回可订阅的 stream 标识
- `process.stdin.write`：写入 stdin（支持 bytes/base64/string）
- `process.stream.subscribe`：订阅 stdout/stderr（支持 filter: stdout|stderr、mode: line|chunk）
- `process.wait`：等待退出并返回 exitCode
- `process.status`：查询 pid、开始时间、资源使用快照

并通过 EVENT/STREAM_CHUNK 推送：
- `kairo.process.stdout.chunk`
- `kairo.process.stderr.chunk`
- `kairo.process.exited`

### 10.2 设备占用与并发控制
新增 methods（示例）：
- `device.claim` / `device.release`
- `device.read` / `device.write` / `device.stream`

### 10.3 服务发现与 Schema
新增 methods（示例）：
- `kernel.introspect`：返回 methods 列表、版本、schema（JSON Schema 或 Zod 导出形式）
- `kernel.ping`：健康检查与 RTT

## 11. 示例 (Examples)
### 11.1 TypeScript 侧（使用现有 IPCClient）
```ts
import { IPCClient } from "../src/domains/kernel/ipc-client";

const socketPath = process.env.KAIRO_IPC_SOCKET || "/tmp/kairo-kernel.sock";
const client = new IPCClient(socketPath);
await client.connect();

const res = await client.request({
  method: "system.get_metrics",
  params: {},
});

console.log(res);
client.close();
```

### 11.2 语言无关实现要点
- 连接 Unix Socket（`/tmp/kairo-kernel.sock` 或从 `KAIRO_IPC_SOCKET` 读取）
- 写入：8 字节 header + MsgPack payload
- 读取：按 header 的 Length 做 framing，再 MsgPack decode
- REQUEST 必须带 `id`；RESPONSE 用相同 `id` 匹配
