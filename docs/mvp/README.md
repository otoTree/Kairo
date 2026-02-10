# AgentOS MVP 规格说明（开发用索引）

本目录把现有代码（`src/`）与架构文档（`docs/architecture/`）收敛为一套“可直接开发/验收”的 MVP 规格说明：列清楚 AgentOS 需要实现的功能模块、模块边界、相互依赖、对外契约与验收标准。

## 1. MVP v0.1 范围

v0.1 的核心目标：把 Kairo 从“可运行 Agent 的应用”推进到“可编排系统资源的 AgentOS 内核”，立刻能支撑真实工作负载：**与任意外部二进制进程进行全双工通信、可观测、可取消**。

进入 v0.1（P0）：
- **Kernel 原语**：ProcessSession + Stdio IO + IPC Push（EVENT/STREAM_CHUNK）
- **事件序列语义**：correlation/causation + 取消语义（以事件顺序自然回溯）
- **权限闭环（最小）**：manifest permissions → sandbox/enforcement（deny-by-default）
- **EventBus**：稳定事件信封、订阅、replay（用于 Agent 与 UI）

不进入 v0.1（但在文档中标注演进点）：
- 设备 claim/release 与统一 streaming 生命周期
- kernel introspect/能力协商/全量 schema 暴露
- 全量 durability/recovery（进程会话恢复、资源锁恢复等）
- artifacts 分发/校验/升级/回滚

对应背景文档：
- [agentos-mvp-v0.1.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/agentos-mvp-v0.1.md)
- [agentos-core-gaps.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/agentos-core-gaps.md)
- [kernel-ipc-spec.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/kernel-ipc-spec.md)
- [global-event-bus-spec.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/global-event-bus-spec.md)

## 2. 功能模块（MVP）与依赖关系

### 2.1 模块图（依赖方向：A → B 表示 A 依赖 B）

```mermaid
flowchart TD
  Core[Core Runtime\n(Plugin Lifecycle)] --> Eventing[Eventing\n(EventBus + Store)]
  Database[Database\n(SQLite)] --> Eventing

  Core --> Kernel[Kernel\n(IPC + Process + Bridge)]
  Eventing --> Kernel
  Sandbox[Sandbox\n(Enforcement)] --> Kernel

  Core --> Agent[Agent Runtime\n(Orchestrator)]
  Eventing --> Agent
  AI[AI Plugin\n(Providers)] --> Agent
  MCP[MCP Plugin\n(Tool Bridge)] --> Agent

  Core --> Skills[Skills Runtime\n(Registry + Runners)]
  Sandbox --> Skills
  Kernel --> Skills
  Eventing --> Skills
  Agent --> Skills

  Agent --> Server[Server\n(WebSocket UI Bridge)]
  Eventing --> Server
```

### 2.2 依赖清单（开发排序建议）

1) Core Runtime → 2) Database（可选，但建议）→ 3) Eventing → 4) Kernel → 5) Sandbox 权限闭环 → 6) Skills → 7) Agent → 8) Server（可选）

## 3. 规格说明目录（每个模块一份 Spec）

- [01-core-runtime.md](file:///Users/hjr/Desktop/Kairo/docs/mvp/01-core-runtime.md)
- [02-eventing.md](file:///Users/hjr/Desktop/Kairo/docs/mvp/02-eventing.md)
- [03-kernel-primitives.md](file:///Users/hjr/Desktop/Kairo/docs/mvp/03-kernel-primitives.md)
- [04-security-sandbox-permissions.md](file:///Users/hjr/Desktop/Kairo/docs/mvp/04-security-sandbox-permissions.md)
- [05-skills-runtime.md](file:///Users/hjr/Desktop/Kairo/docs/mvp/05-skills-runtime.md)
- [06-agent-runtime.md](file:///Users/hjr/Desktop/Kairo/docs/mvp/06-agent-runtime.md)
- [07-server-bridge.md](file:///Users/hjr/Desktop/Kairo/docs/mvp/07-server-bridge.md)

## 4. “完成”的统一定义（跨模块验收口径）

v0.1 完成标准（满足即可，不要求超集）：
- 能通过 Kernel IPC 启动任意短命令，收到 spawned/exited（含 exitCode）
- 能持续接收大体量 stdout/stderr 的 STREAM_CHUNK，且具备最小 backpressure（限速/截断）避免 OOM
- 能对需要 stdin 的进程写入并观测回显（process.stdin.write）
- 能 wait/status，且与实际退出一致
- 取消语义能传播：取消事件 → 进程终止 → 产生 canceled/exited
- 未声明网络权限的二进制在沙箱内无法出网（平台支持时）
