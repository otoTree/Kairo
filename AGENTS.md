# Kairo 代码生成代理指南

本文档用于指导在 Kairo 仓库中进行代码生成、代码重构、模块设计与实现落地时的行为边界。  
任何 agent、自动化代码生成器或协作模型，在修改本仓库代码前，都应优先阅读本文件，再按需参考下列设计文档。

## 1. 必读文档顺序

在生成或修改代码前，优先按以下顺序理解项目：

1. [README.md](/Users/hjr/Desktop/Kairo/README.md)
2. [docs/architecture.md](/Users/hjr/Desktop/Kairo/docs/architecture.md)
3. [docs/object-model.md](/Users/hjr/Desktop/Kairo/docs/object-model.md)
4. [docs/domains.md](/Users/hjr/Desktop/Kairo/docs/domains.md)
5. [docs/platform-realizations.md](/Users/hjr/Desktop/Kairo/docs/platform-realizations.md)
6. [docs/model-substrate.md](/Users/hjr/Desktop/Kairo/docs/model-substrate.md)
7. [docs/dual-execution.md](/Users/hjr/Desktop/Kairo/docs/dual-execution.md)
8. [docs/parametric-execution.md](/Users/hjr/Desktop/Kairo/docs/parametric-execution.md)
9. [docs/wasm-domain.md](/Users/hjr/Desktop/Kairo/docs/wasm-domain.md)
10. [docs/wasm-kernel-boundary.md](/Users/hjr/Desktop/Kairo/docs/wasm-kernel-boundary.md)
11. [docs/agent-environment.md](/Users/hjr/Desktop/Kairo/docs/agent-environment.md)
12. [docs/wasm-executor-training.md](/Users/hjr/Desktop/Kairo/docs/wasm-executor-training.md)
13. [docs/roadmap.md](/Users/hjr/Desktop/Kairo/docs/roadmap.md)

如果实现行为与上述文档冲突，以这些文档表达的系统方向为准，而不是以传统操作系统习惯、Linux 兼容思维或通用框架默认做法为准。

## 2. 项目总纲

Kairo 当前不是：

- Linux 替代内核
- 传统兼容优先的操作系统
- 在操作系统外层叠加的 agent 框架
- 普通推理框架容器

Kairo 当前是：

- agent-native 系统平台
- 模型执行是一等能力的系统
- 模型本身承担 think / review / plan / act 的主体
- 外部系统层只负责环境语义统一、能力边界、执行接口和可验证反馈
- 同时支持 `Parametric Execution` 与 `Sandboxed Execution`
- 同时考虑 CPU / GPU / hybrid realization

任何代码生成都不得把项目重新拉回“传统 OS + 兼容层 + 工具框架”的路线。

## 3. 当前实现优先级

在没有明确新指令前，优先级遵循 [docs/roadmap.md](/Users/hjr/Desktop/Kairo/docs/roadmap.md)：

1. 重组源码骨架
2. 落最小核心对象
3. 建立系统服务边界
4. 建立执行域骨架
5. 建立模型底座对象
6. 建立 Wasm 外执行路径
7. 建立 Agent Environment Layer
8. 最后才扩展参数内执行

这意味着：

- 先做骨架和边界
- 后做能力和实现
- 不要提前堆完整 runtime
- 不要提前堆复杂兼容层

## 4. 禁止回退的方向

代码生成时，禁止将系统设计回退到以下方向：

### 4.1 回退成传统 Linux 风格系统

不要：

- 引入以 `process/thread/fd/path/syscall` 为底层真相的设计
- 为 Linux 兼容主动创建主线模块
- 默认把 ELF / syscall / BusyBox 当近期目标

### 4.2 回退成厚外部 agent runtime

不要：

- 在系统外层实现 planner / reviewer / action loop 作为主逻辑
- 让系统替模型完成 think / review / act

### 4.3 回退成推理框架容器

不要：

- 把 `WeightStore`、`InferenceSession`、`ExecutionPlan` 等对象藏在用户态私有结构里
- 把模型执行能力仅视为外部库调用

### 4.4 回退成 Wasm 万能容器

不要：

- 试图把核心机制、平台主权、最终权限裁决变成 Wasm 模块
- 让 Wasm 绕过系统服务直接操作底层状态

## 5. 核心对象约束

任何实现都应围绕以下统一对象语言展开：

- `Handle`
- `Capability`
- `ExecutionUnit`
- `ProtectionDomain`
- `AddressSpace`
- `Channel`
- `Namespace`
- `FaultEvent`

实现时应遵守：

- `ExecutionUnit` 不等于 thread
- `ProtectionDomain` 不等于传统 process
- `Handle` 不等于权限
- `Capability` 必须显式存在
- `Channel` 是统一通信基础，不要每个模块单独发明消息机制

如果新增对象，优先说明它如何建立在上述对象之上。

## 6. 执行域约束

当前代码骨架应优先围绕以下执行域建立：

- `NativeDomain`
- `InferenceDomain`
- `AgentDomain`
- `WasmDomain`
- `DriverDomain`
- `ServiceDomain`

不要：

- 提前补 `LinuxDomain`
- 在没有统一 `ExecutionDomain` 抽象前，直接写散落的域逻辑

实现时应优先考虑：

- 域如何消费系统服务
- 域如何映射对象视图
- 域如何转换错误和事件

## 7. 模型执行底座约束

模型执行能力必须通过系统对象表达，而不是普通库内部状态。

优先对象：

- `WeightStore`
- `WeightShard`
- `TensorBuffer`
- `KvCache`
- `InferenceSession`
- `ComputeDevice`
- `ExecutionPlan`
- `PlacementPolicy`

不要：

- 把权重当成普通文件处理完就结束
- 把会话当成普通函数调用
- 把缓存当成私有堆对象

## 8. 双层执行约束

Kairo 明确存在两条执行路径：

### 8.1 `Parametric Execution`

适合：

- 低延迟
- 高频
- 结构稳定
- 低副作用逻辑

### 8.2 `Sandboxed Execution`

适合：

- 工具调用
- 副作用逻辑
- 需要 capability 和审计的逻辑

不要：

- 强迫所有执行走同一条路径
- 过早把所有逻辑内化进模型
- 或把所有逻辑都扔给外部 Wasm

## 9. Wasm 相关约束

Wasm 在 Kairo 中有多重角色，但边界必须清晰。

### 9.1 允许的方向

- `WASM-as-Sandbox`
- `WASM-as-Weights`
- `WASM-as-System-Extension`

### 9.2 禁止的方向

不要让 Wasm：

- 成为最终权限裁决者
- 成为最终平台主权持有者
- 成为系统对象真相
- 绕过系统服务操作底层状态

### 9.3 WasmDomain 的职责

代码实现时应优先围绕：

- `WasmModule`
- `WasmInstance`
- `WasmCapability`
- `WasmHostBinding`
- `WasmTrace`

而不是直接上完整通用 Wasm runtime。

## 10. Agent Environment 约束

Kairo 当前不再建设“厚外部 agent runtime”，而是建设 `Agent Environment Layer`。

它应负责：

- 统一 observation schema
- 统一 action surface
- 统一 capability / lease 语义
- 提供 context / memory 的系统载体
- 统一 trace 和反馈

它不应负责：

- 替模型思考
- 外部 planner
- 外部 reviewer
- 外部 action brain

优先对象：

- `ContextObject`
- `MemoryStore`
- `ToolCapability`
- `ExecutionLease`
- `ObservationRecord`
- `ActionSurface`

## 11. 平台实现约束

Kairo 必须兼容：

- CPU realization
- GPU realization
- hybrid realization

因此实现时不要默认：

- CPU 是唯一控制平面
- 执行单元就是 CPU 线程
- 故障就是 CPU trap

新增抽象时，应优先使用平台无关语言。

## 12. 代码生成风格约束

### 12.1 先骨架后细节

优先生成：

- 模块目录
- `mod.rs`
- trait / struct 占位
- 初始化入口
- 注释明确的空实现

不要一开始就生成一大段功能耦合实现。

### 12.2 小步提交式结构

优先一次完成一个层次：

- 先对象
- 再服务
- 再域
- 再底座

不要跨层同时写大量未稳定逻辑。

### 12.3 保持语义可扩展

命名优先使用：

- `ExecutionUnit`
- `ProtectionDomain`
- `Handle`
- `Capability`
- `FaultEvent`

避免过早写死：

- `Process`
- `Thread`
- `Syscall`
- `LinuxError`

### 12.4 中文要求

遵循仓库现有要求：

- 所有代码注释必须使用中文
- 新增文档必须使用中文
- 解释代码逻辑时优先使用中文

## 13. 推荐的源码骨架方向

当前建议的源码骨架应逐步向以下结构靠拢：

```text
kairo-kernel/src/
├── core/
├── object/
├── service/
├── domain/
├── substrate/
│   ├── model/
│   └── parametric/
├── runtime/
│   └── agent_env/
├── realization/
│   ├── cpu/
│   ├── gpu/
│   └── hybrid/
├── arch/
├── boot/
└── main.rs
```

如果任务涉及重构代码结构，优先朝这个方向收敛。

## 14. agent 在实现前应先回答的问题

在真正改代码前，先判断：

1. 这次修改属于哪一层
2. 它是否引入了新的底层对象
3. 它是否错误地把传统兼容语义当成系统真相
4. 它是否把智能逻辑外包给系统层
5. 它是否越过了 Wasm、服务、域之间的边界
6. 它是否与 roadmap 当前阶段匹配

如果任一问题答案不明确，应先补骨架或补注释说明，而不是直接堆实现。

## 15. 当前最推荐的实现顺序

如果没有用户特别指定，默认按以下顺序推进：

1. 建立目录骨架
2. 建立核心对象占位
3. 建立 `ExecutionDomain` 占位
4. 建立模型底座对象占位
5. 建立 `WasmDomain` 占位
6. 建立 `Agent Environment Layer` 占位

## 16. 总结

代码生成代理在 Kairo 中的职责，不是尽快补功能，而是确保所有代码持续朝同一个系统方向收敛：

- 模型是 agent 行为主体
- 系统负责环境语义统一
- Wasm 是关键执行格式
- 双层执行是核心运行机制
- 核心对象优先于传统兼容视图
- 代码骨架优先于功能堆叠

任何偏离上述方向的“快速实现”，都应视为错误优化。
