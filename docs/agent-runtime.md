# Kairo Agent Runtime 设计

本文档定义 Kairo 的 `Agent Runtime Layer`。  
在 Kairo 中，agent 不是普通应用的别名，也不是“在系统上跑的一个大模型进程集合”，而是系统顶层需要原生承载的运行实体。

这意味着 Kairo 不只是要回答“如何运行程序”，还要回答：

- agent 在系统中的一等对象是什么
- agent 的上下文和记忆如何表示
- agent 如何获得工具能力
- agent 如何在双层执行模型上编排任务
- agent 如何在多平台 realization 上保持语义稳定

## 1. 为什么 agent runtime 需要单独建模

如果 Kairo 不单独建模 agent runtime，而是把 agent 当成普通用户态应用，会很快出现以下问题：

- agent 的上下文退化为某个进程内的字符串堆
- 记忆退化为某个私有数据库或缓存
- 工具调用退化为随意子进程或 RPC
- 推理、计划、执行、观察被混在一起
- 多 agent 协作退化为多个服务之间的临时约定

这种做法对“能跑”够了，但对 Kairo 的目标不够。  
Kairo 的目标是让 agent 成为系统原生对象，而不是运行在系统之上的应用约定。

## 2. Agent Runtime 的系统位置

Kairo 的整体位置应理解为：

```text
+------------------------------------------------------+
| Agent Runtime Layer                                  |
| - Agent Instance                                     |
| - Context / Memory / Tool Orchestration              |
| - Policy / Scheduling / Governance                   |
+------------------------------------------------------+
| Dual Execution Layer                                 |
| - Parametric Execution                               |
| - Sandboxed Execution                                |
+------------------------------------------------------+
| Model Runtime Substrate                              |
+------------------------------------------------------+
| Execution Domains                                    |
+------------------------------------------------------+
| System Services                                      |
+------------------------------------------------------+
| Core Mechanisms                                      |
+------------------------------------------------------+
| Platform Realizations                                |
+------------------------------------------------------+
```

Agent Runtime 的位置说明了三件事：

- 它依赖模型底座，但不等于模型底座
- 它依赖执行域与系统服务，但不等于执行域与服务
- 它负责统一编排执行、上下文、记忆和权限

## 3. Agent Runtime 的目标

Agent Runtime 至少应满足以下目标：

1. agent 是系统可识别、可治理、可观察的一等对象
2. 上下文和记忆是系统对象，而不是私有字符串拼接
3. 工具调用必须能力化
4. 双层执行必须由 agent runtime 统一编排
5. 多 agent 协作要有显式消息和任务边界
6. 运行语义跨 CPU / GPU / hybrid realization 尽量稳定

## 4. 核心对象

Agent Runtime 应围绕一组稳定对象构建。当前建议最小对象集合如下。

### 4.1 `AgentInstance`

`AgentInstance` 表示一个运行中的 agent 实体。  
它不等价于进程、线程或单次推理请求，而是更高层的系统对象。

它通常绑定：

- 一个 agent 身份
- 一组上下文对象
- 一组记忆对象
- 一组工具能力
- 一个或多个推理会话
- 一条任务队列或消息入口

### 4.2 `ContextObject`

`ContextObject` 表示 agent 当前可见的上下文片段。  
它不应只是大段文本，而应允许：

- 结构化上下文
- 分段上下文
- 来源标记
- 生命周期管理
- 可见性控制

### 4.3 `MemoryStore`

`MemoryStore` 表示 agent 的长期或中期记忆容器。  
它不等同于简单数据库，而应体现 agent 语义：

- 可写入记忆片段
- 可检索
- 可归档
- 可版本化
- 可附带权限边界

### 4.4 `ToolCapability`

`ToolCapability` 表示 agent 获得的工具使用资格。  
它是 capability 模型在 agent 层的显式体现。

它至少需要约束：

- 能调用哪些工具
- 能访问哪些资源
- 是否允许副作用
- 是否需要审计
- 配额和速率限制

### 4.5 `TaskMailbox`

`TaskMailbox` 表示 agent 的任务与消息入口。  
它用于承载：

- 新任务
- 协作消息
- 外部反馈
- 工具执行结果
- 推理输出回传

### 4.6 `ExecutionLease`

`ExecutionLease` 表示 agent 在某次任务中临时获得的执行资源与权限租约。  
它适合用于统一表达：

- 工具调用许可
- WasmDomain 执行许可
- 推理预算
- 时间窗口
- 设备占用配额

### 4.7 `PlanGraph`

`PlanGraph` 表示 agent 为某个目标组织的计划结构。  
它不应只是自然语言思考结果，也可以是结构化任务图：

- 节点表示子任务
- 边表示依赖或前后约束
- 节点可标注执行策略

### 4.8 `ObservationRecord`

`ObservationRecord` 表示 agent 在任务执行过程中得到的观察结果。  
它可来自：

- 模型输出
- Wasm 执行结果
- 系统服务返回
- 人类反馈
- 外部环境变化

## 5. 对象关系

推荐关系如下：

```text
AgentInstance
  ├── ContextObject*
  ├── MemoryStore*
  ├── ToolCapability*
  ├── TaskMailbox
  ├── ExecutionLease*
  ├── PlanGraph?
  └── InferenceSession*
```

这个关系表达了一个关键事实：

- agent runtime 并不是“包一层聊天上下文”
- 它是围绕 agent 实体组织的一整组系统对象

## 6. AgentInstance 的生命周期

### 6.1 创建

创建阶段至少应确定：

- agent 身份
- 初始上下文
- 初始记忆绑定
- 默认工具能力
- 可用执行域范围

### 6.2 运行

运行阶段应支持：

- 接收任务
- 读取上下文
- 调用推理
- 发起双层执行
- 更新记忆
- 处理异常和反馈

### 6.3 暂停与恢复

Agent 不应默认是“一次请求一次销毁”的短生命周期对象。  
因此应支持：

- 暂停
- 恢复
- 状态快照
- 任务继续执行

### 6.4 终止

终止时应明确：

- 记忆如何保留
- 租约如何归还
- trace 如何归档
- 未完成任务如何处理

## 7. 上下文模型

上下文是 agent runtime 的核心资源之一，但不能退化成单一 prompt 字符串。

### 7.1 ContextObject 的要求

应支持：

- 片段化
- 可组合
- 来源可追踪
- 生命周期管理
- 优先级或重要性标记

### 7.2 为什么不能只是 prompt

如果上下文只是 prompt 拼接：

- 无法精确治理成本
- 无法精确做可见性控制
- 无法稳定支持多 agent 协作
- 无法高效持久化与迁移

### 7.3 与模型底座的关系

ContextObject 会影响：

- `InferenceSession`
- `KvCache`
- 记忆检索路径
- 任务计划选择

因此上下文虽然是 agent 对象，但会深度作用于模型底座。

## 8. 记忆模型

### 8.1 MemoryStore 的作用

`MemoryStore` 不是简单日志仓库，而是 agent 可消费的长期认知资源。

它应支持：

- 写入
- 检索
- 更新
- 归档
- 权限与归属

### 8.2 记忆类型

可以逐步区分：

- 情景记忆
- 工具经验记忆
- 用户偏好记忆
- 任务状态记忆
- 系统协作记忆

### 8.3 风险

如果记忆系统不单独建模，很容易退化为：

- 私有向量库
- 不透明缓存
- 无法治理的长期状态

## 9. 工具模型

工具调用是 agent runtime 中安全风险最高的一类行为，因此必须能力化。

### 9.1 ToolCapability

它至少应约束：

- 工具身份
- 允许的输入范围
- 输出类型
- 是否允许副作用
- 可访问资源范围
- 审计要求

### 9.2 典型路径

建议路径为：

1. AgentInstance 识别需要工具
2. Agent Runtime 评估策略
3. 检查或申请 `ToolCapability`
4. 若需要外执行，则创建 `ExecutionLease`
5. 进入 `WasmDomain` 或其他受控执行域
6. 返回 `ObservationRecord`

### 9.3 为什么不能只靠 prompt 约束

因为 prompt 约束不等于系统权限。  
Kairo 必须保证：

- 没有 capability 就没有执行资格
- 没有 lease 就没有临时资源占用资格

## 10. 与双层执行的关系

Agent Runtime 是双层执行的主要编排层。

### 10.1 Parametric Execution

适合：

- 低延迟内部计算
- 短程结构化推导
- 内部状态推进

### 10.2 Sandboxed Execution

适合：

- 工具调用
- 外部资源访问
- 副作用任务
- 需要审计和重放的动作

### 10.3 Agent Runtime 的职责

Agent Runtime 负责：

- 判断任务走哪条执行路径
- 绑定上下文和记忆
- 管理执行租约
- 收集内部 trace 和外部 trace
- 将结果写回 agent 状态

## 11. 与执行域的关系

### 11.1 与 InferenceDomain

Agent Runtime 不直接操作底层推理资源，而通过 `InferenceDomain` 消费模型执行能力。

### 11.2 与 WasmDomain

Agent Runtime 不直接裸调工具，而通过 `WasmDomain` 承载受控外执行。

### 11.3 与 NativeDomain / LinuxDomain

它们可以提供应用或服务环境，但 agent runtime 的对象语义不应被它们吞没。

## 12. 与平台实现的关系

Agent Runtime 语义应尽量跨 realization 稳定：

- CPU realization
- GPU realization
- hybrid realization

变化的是承载方式，而不是顶层对象语义。

### 12.1 CPU realization

适合早期完整实现 agent runtime 全路径。

### 12.2 GPU realization

纯 GPU realization 下，某些外部工具能力可能需要桥接环境或被裁剪。  
但：

- `AgentInstance`
- `ContextObject`
- `ExecutionLease`
- `PlanGraph`

这些对象语义不应消失。

### 12.3 Hybrid realization

最适合长期目标：

- 模型执行主要落在 GPU
- 部分编排、治理、工具桥接落在 CPU
- 语义上仍是统一的 agent runtime

## 13. trace 与治理

Agent Runtime 必须具备强治理能力。

### 13.1 建议区分的 trace

- `AgentDecisionTrace`
- `InternalExecutionTrace`
- `WasmTrace`
- `ObservationRecord`

### 13.2 治理目标

- 能追踪 agent 为什么做出某个动作
- 能追踪模型内部执行了什么
- 能追踪外部模块实际做了什么
- 能追踪哪些能力被消耗

## 14. 推荐源码骨架方向

未来可逐步引入如下结构：

```text
kairo-kernel/src/runtime/agent/
├── mod.rs
├── instance.rs
├── context.rs
├── memory.rs
├── capability.rs
├── mailbox.rs
├── lease.rs
├── plan.rs
└── trace.rs
```

语义上可理解为：

- `instance.rs`：`AgentInstance`
- `context.rs`：`ContextObject`
- `memory.rs`：`MemoryStore`
- `capability.rs`：`ToolCapability`
- `mailbox.rs`：`TaskMailbox`
- `lease.rs`：`ExecutionLease`
- `plan.rs`：`PlanGraph`
- `trace.rs`：治理与审计对象

## 15. 当前阶段建议

Kairo 当前还不需要完整实现 agent runtime，但必须尽早统一以下判断：

1. agent 是系统对象，不是普通应用进程
2. 上下文是对象，不是 prompt 字符串
3. 记忆是对象，不是私有缓存
4. 工具调用必须 capability-first
5. 双层执行必须由 agent runtime 统一编排

## 16. 结论

Kairo 的 Agent Runtime Layer 的意义，不是给系统加一层“更聪明的应用框架”，而是把 agent 本身提升为系统原生承载目标。

如果 Model Runtime Substrate 负责“模型如何运行”，  
如果 Dual Execution Layer 负责“逻辑如何执行”，  
那么 Agent Runtime 负责的就是：

- 谁在执行
- 为什么执行
- 可以执行什么
- 执行后如何持续存在、记忆、协作和治理
