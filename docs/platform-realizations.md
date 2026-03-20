# Kairo 平台实现模型

本文档定义 Kairo 的 `Platform Realization` 模型，用于回答一个基础问题：同一套系统语义，如何在纯 CPU、纯 GPU、以及 CPU/GPU 混合平台上分别落地。

这份文档存在的原因很直接。传统操作系统默认假设：

- CPU 是唯一控制平面
- GPU 是 CPU 驱动的协处理器
- 调度、异常、对象管理、资源治理都由 CPU 承担

但 Kairo 的目标平台不止这一种。Kairo 必须支持：

- 纯 CPU
- 纯 GPU
- CPU/GPU 混合

并且这里的“纯 GPU”不是指 GPU 为主、CPU 为辅，而是可能不存在通用 CPU 控制流参与。  
因此 Kairo 不能把 CPU 视为默认实现前提，必须先定义跨平台不变的系统语义，再定义各类平台如何承载这些语义。

## 1. 核心原则

### 1.1 CPU 不是默认控制平面

Kairo 的架构不以 CPU 作为默认控制平面。任何核心机制都必须先被定义为平台无关的系统语义，再由具体平台决定如何承载。

这意味着以下概念不能在架构层直接写死为 CPU 专属：

- 调度
- 中断
- 异常
- 内核主循环
- 线程
- 进程
- syscall

这些都只能是某些执行域或某些平台上的具体表现形式。

### 1.2 先定义语义，再定义实现

Kairo 应先定义：

- 哪些对象存在
- 哪些资源可分配
- 哪些事件可投递
- 哪些边界需要隔离
- 哪些服务需要被访问

然后再回答：

- 在 CPU 平台上谁来执行这些语义
- 在 GPU 平台上谁来执行这些语义
- 在混合平台上如何拆分执行责任

### 1.3 平台实现不改变系统身份

Kairo 不应因为底层平台不同而变成不同系统。  
纯 CPU realization、纯 GPU realization、hybrid realization 都只是同一套系统语义的不同承载方式，而不是三套彼此割裂的操作系统。

### 1.4 资源与控制应解耦

控制逻辑不应默认依附在某类计算资源上。  
CPU 可以承载控制，GPU 也可以承载控制，混合平台则可以拆分控制与执行责任。  
架构必须允许控制平面和执行平面重叠，也允许它们分离。

## 2. 什么是 Platform Realization

`Platform Realization` 指的是：  
Kairo 的统一系统语义，在某一类硬件基础上的具体落地方式。

它至少回答以下问题：

- 哪类设备承担控制平面
- 哪类设备承担主要执行平面
- 对象元数据存放在哪里
- 事件与故障如何表示
- 内存对象如何驻留与迁移
- 域和服务如何被调度

Platform Realization 不是执行域，也不是服务。  
执行域回答“外部环境语义是什么”，平台实现回答“这些语义由什么物理承载”。

## 3. 跨平台不变的系统语义

无论底层是纯 CPU、纯 GPU 还是混合，Kairo 都应尽量保持以下系统语义稳定。

### 3.1 对象语义

以下对象应在三类 realization 中都存在：

- `Handle`
- `Capability`
- `AddressSpace` 或等价隔离视图
- `ExecutionUnit`
- `ProtectionDomain`
- `Channel`
- `Namespace`
- `WeightStore`
- `TensorBuffer`
- `KvCache`
- `InferenceSession`
- `ExecutionPlan`

它们的内部实现可以变化，但外部语义不应随平台彻底断裂。

### 3.2 服务语义

以下服务边界也应尽量稳定：

- Process Service
- File Service
- Namespace Service
- Device Service
- Network Service
- Model Runtime Service

某些 realization 可能不实现全部服务，但已存在服务的契约不应因平台差异而任意变形。

### 3.3 事件语义

Kairo 应使用更中性的事件模型，而不是默认使用 CPU 式中断/异常语义。  
推荐统一抽象为：

- `ControlEvent`
- `FaultEvent`
- `WakeEvent`
- `CompletionEvent`
- `DispatchEvent`

不同 realization 只负责定义这些事件如何被承载。

### 3.4 域语义

Linux domain、Native domain、Inference domain、Agent domain、Driver domain、Service domain 这些执行域概念，不应随平台变化而失效。  
变化的是它们如何被调度、在哪些设备上运行、有哪些能力可用。

## 4. 纯 CPU Realization

纯 CPU realization 是最容易理解的模式，也是最适合早期 bring-up 的平台。

### 4.1 基本特征

- 控制平面由 CPU 承担
- 主要执行平面也由 CPU 承担
- 模型推理完全运行在 CPU 后端
- GPU/NPU 不存在或不可用

### 4.2 适用场景

- 早期系统 bring-up
- 调试和验证
- 虚拟机环境
- 无加速器设备
- 小模型或低资源配置

### 4.3 设计重点

纯 CPU realization 需要重点关注：

- 大对象内存映射
- 权重懒加载
- 多线程并行推理
- 高效缓存管理
- `KvCache` 配额与回收
- CPU 向量化后端支持

### 4.4 风险

如果过度围绕纯 CPU realization 设计，架构会重新滑回传统 OS 假设，例如：

- 把 `ExecutionUnit` 直接等价为线程
- 把异常模型写死为 CPU trap
- 把 GPU 视为未来附加设备

因此纯 CPU realization 只能是实现入口，不能成为架构真相。

## 5. 纯 GPU Realization

纯 GPU realization 是 Kairo 最特殊、也最有区分度的平台模式。  
它要求系统在不存在通用 CPU 控制流的前提下，依然能够维持最小系统语义。

### 5.1 基本特征

- 不存在通用 CPU 控制平面
- 控制逻辑由 GPU 可持续执行单元、图执行机制或事件驱动内核承担
- 模型执行与系统控制高度耦合在 GPU 计算资源上
- 对象元数据、调度状态和会话状态必须可由 GPU 侧访问和维护

### 5.2 这不是“GPU 加速”

纯 GPU realization 不等于：

- CPU 上运行一个程序，然后把矩阵乘法丢给 GPU

它更接近：

- GPU 自身承载运行时控制、执行推进和资源治理的某种系统实现

因此它要求 Kairo 的抽象不要绑定 CPU 语言。

### 5.3 设计重点

纯 GPU realization 需要重点解决：

- 如何表示控制流推进
- 如何维护对象元数据
- 如何进行资源分配与回收
- 如何表示故障与恢复
- 如何组织 `ExecutionPlan`
- 如何让 `InferenceSession` 在 GPU 侧持续存在并可被调度

### 5.4 推荐抽象

为了适配纯 GPU realization，Kairo 应优先使用以下中性概念：

- `ExecutionEngine`
- `DispatchQueue`
- `DispatchUnit`
- `FaultEvent`
- `ControlEvent`
- `PersistentRuntimeContext`

而不是直接以：

- `CPU thread`
- `kernel stack`
- `syscall`
- `interrupt handler`

作为系统真相。

### 5.5 纯 GPU realization 的限制

纯 GPU realization 不一定天然具备完整的外部环境交互能力。  
例如文件、网络、外设访问、工具调用等能力，可能需要通过额外桥接环境提供，或者在某些平台上被裁剪。

因此需要区分：

- 系统内部最小运行能力
- 面向外部环境的桥接能力

后者不应被错误地当成纯 GPU realization 的前提。

## 6. Hybrid Realization

hybrid realization 是最贴近现实大模型系统的模式。  
在这个模式里，CPU 和 GPU 都存在，但它们不应被理解为“主机 + 外设”的固定关系，而应被理解为协同承载系统语义的两个执行平面。

### 6.1 基本特征

- CPU 和 GPU 同时存在
- 控制平面可能主要落在 CPU，也可能拆分给 CPU 与 GPU
- 模型执行跨 CPU / GPU 分布
- 权重、张量、缓存和会话对象需要跨设备放置与迁移

### 6.2 设计重点

hybrid realization 需要重点支持：

- `ExecutionPlan` 的跨设备切分
- `TensorBuffer` 的分层驻留
- `KvCache` 的 CPU/GPU 协同放置
- 数据迁移与预取
- 带宽与容量感知调度
- 回退与降级策略

### 6.3 关键风险

hybrid realization 最常见的退化路径是：

- 控制逻辑全部写死在 CPU
- GPU 被当成黑盒加速器
- 权重与缓存放置逻辑藏在用户态 runtime 私有实现里

这种做法会让系统失去对模型执行的全局控制能力，也会让纯 GPU realization 无法成立。

## 7. 控制平面与执行平面

为了统一三种 realization，Kairo 应显式区分：

- `Control Plane`
- `Execution Plane`

### 7.1 Control Plane

负责：

- 对象生命周期推进
- 事件分发
- 资源配额与治理
- 会话管理
- 执行计划推进

### 7.2 Execution Plane

负责：

- 实际计算执行
- 数据读写
- 图节点推进
- 推理内核执行

### 7.3 三种 realization 中的关系

在纯 CPU realization 中：

- Control Plane 和 Execution Plane 都主要由 CPU 承载

在纯 GPU realization 中：

- Control Plane 和 Execution Plane 都由 GPU 承载

在 hybrid realization 中：

- 二者可以部分重叠，也可以拆分协作

这个区分很重要，因为它能让 Kairo 避免把“控制等于 CPU”写进系统底层。

## 8. 内存与驻留模型

不同 realization 下，内存模型会有不同重点，但核心语义应统一。

### 8.1 统一要求

以下能力都应尽量通过统一对象表达：

- 大对象只读共享
- 分段驻留
- 懒加载
- 可迁移缓冲
- pinned memory 或等价固定区域
- 分层缓存

### 8.2 CPU realization 重点

- 普通内存映射
- 多线程访问一致性
- 页级回收与缓存

### 8.3 GPU realization 重点

- 显存对象生命周期
- 控制元数据可访问性
- 长驻会话状态
- 图执行相关缓冲

### 8.4 Hybrid realization 重点

- 主存与显存的分层放置
- 迁移开销控制
- 跨设备一致性
- `WeightStore`、`TensorBuffer`、`KvCache` 的协同管理

## 9. 故障与恢复模型

为了支持不同 realization，Kairo 需要使用更中性的故障模型。

### 9.1 推荐故障对象

- `FaultEvent`
- `AccessViolation`
- `ExecutionFault`
- `ResourceExhausted`
- `DeviceResetEvent`

### 9.2 CPU realization 中的来源

- CPU exception
- 页错误
- 非法访问
- 调度异常

### 9.3 GPU realization 中的来源

- dispatch 失败
- 设备队列故障
- 显存不足
- 图执行中断
- 持久化执行上下文崩溃

### 9.4 原则

故障来源可以不同，但不应让上层域和服务直接依赖某一类平台特有术语。

## 10. 对执行域的影响

Platform Realization 不替代 Execution Domain，但会影响域的承载方式。

### 10.1 Linux Domain

Linux domain 更容易首先落在纯 CPU 或 hybrid realization 上。  
纯 GPU realization 下，Linux domain 可能不可用，或只能以受限桥接方式存在。

### 10.2 Native Domain

Native domain 应是最适合跨 realization 迁移的执行域，因为它不受 Linux 历史语义束缚。

### 10.3 Inference Domain

Inference domain 应被视为与三种 realization 都强相关的核心执行域：

- 在纯 CPU realization 中运行 CPU 推理
- 在纯 GPU realization 中运行 GPU-native 推理
- 在 hybrid realization 中运行跨设备推理

### 10.4 Agent Domain

Agent domain 的上层语义应尽量稳定，但不同 realization 下其外部环境能力可能不同。例如纯 GPU realization 中，某些工具调用或外部桥接能力可能受限。

## 11. 推荐源码骨架方向

为了体现 realization 概念，后续代码组织可以逐步靠近：

```text
kairo-kernel/src/
├── core/
├── object/
├── domain/
├── service/
├── substrate/
│   ├── model/
│   └── agent/
├── realization/
│   ├── cpu/
│   ├── gpu/
│   └── hybrid/
├── arch/
├── boot/
└── main.rs
```

这里：

- `core/` 表示平台无关核心机制
- `domain/` 表示执行域语义
- `substrate/` 表示模型和 agent 的系统级底座
- `realization/` 表示各平台对统一语义的承载方式

这能帮助代码层面避免默认把 CPU 当底层真相。

## 12. 当前阶段建议

对 Kairo 当前仓库而言，最重要的不是立刻支持三种 realization 的完整实现，而是先把设计语言改对。

当前最值得优先落实的是：

1. 所有核心对象命名避免 CPU 假设
2. 文档中明确区分系统语义与平台承载
3. 在执行域文档中加入 `InferenceDomain` 和 `AgentDomain`
4. 在模型底座文档中明确 `WeightStore`、`TensorBuffer`、`KvCache`、`InferenceSession`、`ExecutionPlan`

## 13. 结论

Kairo 的平台目标不是“支持 GPU 加速”，而是：

- 支持纯 CPU 承载系统语义
- 支持纯 GPU 承载系统语义
- 支持 CPU/GPU 混合承载系统语义

因此 Kairo 必须把 CPU 从默认架构前提中拿掉，把平台实现视为统一系统语义的不同 realization。  
只有这样，Kairo 才有可能同时成为可扩展的系统平台、模型执行底座，以及真正面向 agent 的运行环境。
