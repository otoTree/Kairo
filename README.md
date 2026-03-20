# Kairo

Kairo 是一个以 Rust 为主实现的 agent-native 系统平台原型。  
它的目标不是复刻传统 Linux 内核，也不是做一个只负责启动和调度普通进程的操作系统，而是构建一个能够原生承载模型执行、模型内生 agent 行为、多执行域和多平台实现的统一系统底座。

当前仓库仍处于极早期阶段，现有代码主要完成了最小内核启动、串口输出、framebuffer 验证和基础构建流程。真正重要的工作还在架构层：在功能大规模展开之前，先把系统语义、对象模型、执行边界和平台方向定准。

## 1. 项目定位

Kairo 的长期目标不是“做一个更现代的宏内核”，而是构建一个面向以下需求的系统平台：

1. 最小而稳定的核心机制
2. 可演化的系统服务与对象模型
3. 多执行域共存
4. 模型执行作为系统一等能力
5. 模型内生 agent 行为作为顶层目标
6. 纯 CPU、纯 GPU、hybrid 三类平台实现
7. 不为传统 Linux 生态兼容保留目标地位

因此，Kairo 更接近：

- 一个 agent-native systems platform
- 一个 model-aware execution substrate
- 一个支持内执行与外执行协同的多层运行环境

而不只是一个传统意义上的操作系统。

## 2. 定调原则

### 2.1 核心只保留稳定机制

Kairo 的核心层不应过早承载 POSIX、传统文件系统、传统线程模型等高层语义。  
核心层应只保留最难替换、最需要稳定的机制，例如：

- 对象引用
- 最小隔离
- 执行单元
- 事件与故障
- 地址空间或等价隔离视图
- 最小权限检查

### 2.2 高层语义通过服务与域组织

高层能力不应默认堆进核心，而应通过两类边界组织：

- `System Services`
- `Execution Domains`

前者定义系统能力边界，后者定义对外运行环境语义。

### 2.3 模型执行是系统能力，不是普通应用行为

权重、张量、KV cache、推理会话、执行计划、计算设备都应被视为系统对象，而不是普通用户态进程的私有实现细节。

### 2.4 模型是 agent 行为主体

Kairo 不应构建一个厚重的外部 runtime 去替模型完成 think、review、plan、act。  
这些行为应尽量内化到模型本身。外部系统层只负责：

- 环境语义统一
- observation 统一
- action surface 统一
- capability 与 lease 边界
- 资源治理与可验证反馈

### 2.5 CPU 不是默认控制平面

Kairo 必须支持：

- 纯 CPU realization
- 纯 GPU realization
- CPU/GPU hybrid realization

并且纯 GPU 情况可能不存在通用 CPU 控制流参与。  
因此任何核心抽象都不能默认写死为 CPU 专属。

### 2.6 不为传统 Linux 兼容保留地位

Kairo 当前阶段不以兼容传统 Linux 生态为目标。  
任何未来可能出现的兼容层，都只能作为边缘桥接能力存在，不能反向定义 Kairo 的核心对象模型、执行模型和平台设计。

## 3. 总体架构

Kairo 当前建议采用如下整体结构：

```text
+------------------------------------------------------+
| Model Core                                           |
| - think / review / plan / act / self-check           |
| - parametric execution                               |
+------------------------------------------------------+
| Agent Environment Layer                              |
| - observation / action / capability / lease          |
| - context / memory surfaces                          |
+------------------------------------------------------+
| Dual Execution Layer                                 |
| - Parametric Execution                               |
| - Sandboxed Execution                                |
+------------------------------------------------------+
| Model Runtime Substrate                              |
| - Weight Store                                       |
| - Tensor Buffer                                      |
| - KV Cache                                           |
| - Inference Session                                  |
| - Execution Plan                                     |
+------------------------------------------------------+
| Execution Domains                                    |
| - Native Domain                                      |
| - Inference Domain                                   |
| - Agent Domain                                       |
| - Wasm Domain                                        |
| - Driver Domain                                      |
| - Service Domain                                     |
+------------------------------------------------------+
| System Services                                      |
| - Process / File / Namespace / Device / Network      |
+------------------------------------------------------+
| Core Mechanisms                                      |
| - Handle / Capability / Channel / Fault / Isolation  |
+------------------------------------------------------+
| Platform Realizations                                |
| - CPU / GPU / Hybrid                                 |
+------------------------------------------------------+
```

这套结构体现了 Kairo 的几条关键判断：

- 不是所有执行都应该发生在模型外部
- 也不是所有逻辑都应该进入权重
- 执行域和平台实现是两层不同概念
- 模型本身是 agent 行为主体，系统负责统一环境语义

## 4. 核心对象方向

在功能展开前，Kairo 更需要先稳定对象模型。当前建议优先围绕以下对象统一系统语言：

- `Handle`
- `Capability`
- `ExecutionUnit`
- `ProtectionDomain`
- `AddressSpace`
- `Channel`
- `Namespace`
- `WeightStore`
- `TensorBuffer`
- `KvCache`
- `InferenceSession`
- `ExecutionPlan`
- `ExecutionDomain`

最重要的约束是：

- `ExecutionUnit` 不应直接等于 thread
- `ProtectionDomain` 不应直接等于传统 process
- `ExecutionDomain` 不应直接等于系统整体
- `InferenceSession` 不应直接等于普通进程
- `WeightStore` 不应直接等于普通文件

## 5. 双层执行

Kairo 明确支持两类执行能力：

### 5.1 Parametric Execution

指程序逻辑被内化到模型参数、模型内部执行器或推理快路径中。  
它适合：

- 高频
- 低延迟
- 结构稳定
- 不涉及强副作用

### 5.2 Sandboxed Execution

指程序逻辑在独立、受控、可审计的执行边界中运行。  
在 Kairo 中，这类执行的主要载体应是 `WasmDomain`。

这意味着 Wasm 在 Kairo 中可能有两种角色：

- `WASM-as-Weights`
- `WASM-as-Sandbox`

Kairo 不应在这两者之间二选一，而应允许统一编排。

## 6. 平台方向

Kairo 必须原生支持三类平台实现：

### 6.1 CPU Realization

适合作为早期 bring-up、调试和基础验证平台。

### 6.2 GPU Realization

纯 GPU 不是“GPU 加速”，而是可能由 GPU 直接承载控制与执行语义的系统实现形态。

### 6.3 Hybrid Realization

CPU 与 GPU 协同承载模型执行、环境语义层和系统控制。

## 7. 传统生态的处理方式

Kairo 当前阶段不为传统 Linux 生态兼容保留主线资源。  
这意味着：

- 不以 ELF / syscall / BusyBox 兼容作为近期目标
- 不让传统进程、线程、文件描述符模型反向定义底层对象
- 不在 roadmap 中为 Linux 兼容保留主路线位置

如果未来确实需要桥接传统生态，也只能作为附属能力接入，而不是牵引系统主方向。

## 8. 当前仓库状态

当前代码仍然停留在最小启动原型阶段，主要集中在：

- [`kairo-kernel/src/main.rs`](/Users/hjr/Desktop/Kairo/kairo-kernel/src/main.rs)
- [`kairo-kernel/src/serial.rs`](/Users/hjr/Desktop/Kairo/kairo-kernel/src/serial.rs)
- [`kairo-kernel/src/vga_buffer.rs`](/Users/hjr/Desktop/Kairo/kairo-kernel/src/vga_buffer.rs)
- [`kairo-kernel/src/boot_config.rs`](/Users/hjr/Desktop/Kairo/kairo-kernel/src/boot_config.rs)
- [`xtask/src/main.rs`](/Users/hjr/Desktop/Kairo/xtask/src/main.rs)

## 9. 文档地图

当前文档应按以下顺序阅读：

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
12. [docs/roadmap.md](/Users/hjr/Desktop/Kairo/docs/roadmap.md)

## 10. 当前定调结论

Kairo 后续不应再沿着“传统 OS + Linux 兼容 + 跑几个程序”的路线推进，而应统一坚持以下定调：

- Kairo 是 agent-native system platform
- 模型执行是系统一等能力
- 模型内生 agent 行为是顶层目标
- 双层执行是核心运行机制
- Wasm 是关键执行格式，而不是单一用途组件
- 平台实现必须兼容 CPU、GPU 和 hybrid
- 不为传统 Linux 兼容保留目标地位
