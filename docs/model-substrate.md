# Kairo 模型执行底座设计

本文档定义 Kairo 的 `Model Runtime Substrate`，也就是模型执行相关的系统级基础设施。  
它的目标不是描述某个具体推理框架如何实现，而是回答一个更底层的问题：

如果 Kairo 不只是一个通用操作系统，而是一个面向模型与 agent 的系统平台，那么模型权重、张量缓冲、KV cache、推理会话和异构执行计划应如何被系统原生建模。

这份文档建立在以下前提之上：

- Kairo 必须支持纯 CPU、纯 GPU、以及 CPU/GPU 混合三类平台实现
- 纯 GPU 可能不存在通用 CPU 控制平面
- 模型执行不是普通用户态程序的私有细节，而是系统一等能力
- agent runtime 将建立在模型执行底座之上，而不是反过来定义底座

## 1. 为什么模型执行必须成为系统能力

如果 Kairo 只做成一个“普通 OS”，然后让用户态程序自己运行模型，会很快遇到几个结构性问题：

- 权重只是大文件，系统不知道它的语义
- KV cache 只是进程私有内存，系统无法配额、复用、迁移和观察
- GPU 只是设备，系统不知道哪些任务是推理任务
- CPU/GPU 混合放置逻辑藏在用户态 runtime 内部，系统无法统一治理
- 多模型并发最终退化为多个大进程争抢资源，系统看不见真实瓶颈

这会让 Kairo 最终只是“能跑推理框架的系统”，而不是“理解模型执行的系统”。

因此 Kairo 必须把以下内容视为系统级资源：

- 权重对象
- 张量缓冲
- 上下文缓存
- 推理会话
- 计算设备
- 执行计划

## 2. 模型底座的目标

Kairo 的模型执行底座应满足以下目标：

1. 在纯 CPU、纯 GPU、hybrid realization 中保持统一语义
2. 把模型执行资源从普通匿名内存和普通文件中提升为系统对象
3. 允许多个执行域共享底座能力
4. 为 agent runtime 提供稳定的推理与上下文支撑
5. 支持调度、配额、隔离、缓存、迁移和恢复

换句话说，模型底座既不是单纯驱动层，也不是单纯用户态库，而是介于核心机制、系统服务和执行域之间的专门基础设施层。

## 3. 在整体架构中的位置

推荐将 Kairo 架构理解为：

```text
+------------------------------------------------------+
| Agent Runtime Layer                                  |
| - Agent Instance                                     |
| - Context / Memory / Tool Orchestration              |
+------------------------------------------------------+
| Model Runtime Substrate                              |
| - Weight Store                                       |
| - Tensor Buffer Manager                              |
| - KV Cache Manager                                   |
| - Inference Session Manager                          |
| - Compute Device Scheduler                           |
| - Execution Plan Coordinator                         |
+------------------------------------------------------+
| Execution Domains                                    |
| - Linux Domain                                       |
| - Native Domain                                      |
| - Inference Domain                                   |
| - Agent Domain                                       |
| - Driver Domain                                      |
| - Service Domain                                     |
+------------------------------------------------------+
| System Services                                      |
| - File / Namespace / Device / Network / Process      |
+------------------------------------------------------+
| Core Mechanisms                                      |
+------------------------------------------------------+
```

这里的关键点是：

- 模型底座不属于普通 File Service 或 Device Service 的简单子集
- 它也不是某个单独执行域
- 它是多个域共享的底层能力层

例如：

- Linux domain 中的推理框架可以调用模型底座
- Native domain 中的原生程序也可以调用模型底座
- Agent domain 则更深地依赖模型底座

## 4. 核心对象

模型执行底座应围绕一组稳定对象构建。建议最小对象集合如下。

### 4.1 `WeightStore`

`WeightStore` 表示一组可供模型执行使用的权重对象集合。

它不应被简单视为普通文件，而应具备以下语义：

- 版本化
- 可校验
- 可分片
- 只读共享
- 懒加载
- 支持不同 realization 下的多级驻留

一个 `WeightStore` 可能对应：

- 本地权重文件集
- 已解包的模型分片集合
- 可映射的只读权重对象
- 已驻留在 GPU 显存中的权重视图

### 4.2 `WeightShard`

如果模型较大，权重必须支持分片管理。  
`WeightShard` 是 `WeightStore` 的最小可调度、可迁移、可校验子对象。

它应支持：

- 独立装载
- 独立驻留
- 独立回收
- 独立状态跟踪

### 4.3 `TensorBuffer`

`TensorBuffer` 表示运行中使用的张量缓冲对象。

它不应只是普通堆内存，而应具备以下信息：

- 数据类型
- 形状或布局描述
- 逻辑所属会话
- 当前驻留位置
- 是否可迁移
- 是否可共享
- 是否为临时缓冲

`TensorBuffer` 可以位于：

- CPU 内存
- GPU 显存
- 特定固定区域
- 可在多级存储之间迁移

### 4.4 `KvCache`

`KvCache` 是模型底座中的关键对象，不应藏在某个运行时的私有实现里。

它表示：

- 上下文相关的中间状态缓存
- token 历史对应的注意力缓存
- 推理会话的重要长期资源

它需要支持：

- 配额控制
- 分层驻留
- 回收策略
- 共享策略
- 生命周期绑定

### 4.5 `InferenceSession`

`InferenceSession` 表示一次模型推理会话，是模型底座最关键的一等对象之一。

它通常绑定：

- 一个模型或模型变体
- 一个 `WeightStore`
- 一个或多个 `TensorBuffer`
- 一个 `KvCache`
- 一组可用计算设备
- 一个 `ExecutionPlan`
- 一条输出流或结果通道

它必须具备：

- 创建
- 暂停
- 恢复
- 取消
- 限速
- 配额审计
- 错误上报

### 4.6 `ComputeDevice`

`ComputeDevice` 表示可用于模型执行的计算设备。

它不只是驱动层中的“设备句柄”，而是模型底座理解的执行资源。  
典型例子包括：

- CPU 集群
- GPU 设备
- NPU 设备
- 特定张量执行单元

它至少应暴露：

- 容量信息
- 内存层级
- 支持的数据格式
- 并发能力
- 队列或 dispatch 能力
- 是否可承担控制平面职责

### 4.7 `ExecutionPlan`

`ExecutionPlan` 是将纯 CPU、纯 GPU 和混合执行统一起来的中心对象。

它定义：

- 模型如何被切分
- 权重如何放置
- 张量如何流动
- 哪些阶段在哪些设备上执行
- 回退策略是什么
- 数据迁移何时发生

它不能只是某个框架里的临时图对象，而应具备系统级可见性。

### 4.8 `PlacementPolicy`

`PlacementPolicy` 描述模型资源应如何被放置和迁移。  
它可用于控制：

- 权重放置
- `TensorBuffer` 放置
- `KvCache` 放置
- 混合模式下的设备分工

### 4.9 `GraphExecutable`

如果某个 realization 或某个模型后端需要编译后的执行图、kernel plan 或 dispatch graph，那么这类结果应被表示为 `GraphExecutable`。

它代表：

- 已经过优化或编译的执行产物
- 可被多个会话复用的执行计划载体
- 与特定设备或特定后端相关的执行准备结果

## 5. 对象关系

这些对象之间建议形成如下关系：

```text
WeightStore
  └── WeightShard*

InferenceSession
  ├── WeightStore
  ├── TensorBuffer*
  ├── KvCache
  ├── ComputeDevice*
  ├── ExecutionPlan
  └── OutputChannel

ExecutionPlan
  ├── PlacementPolicy
  ├── GraphExecutable?
  └── DeviceAssignment*
```

这里最重要的是：

- `InferenceSession` 是运行中心
- `ExecutionPlan` 是调度中心
- `WeightStore` 是模型资源中心
- `KvCache` 是上下文状态中心

## 6. 三种 realization 下的语义要求

模型底座必须跨平台保持稳定，但不同平台侧重点不同。

### 6.1 纯 CPU realization

在纯 CPU 模式下：

- `ComputeDevice` 主要是 CPU 计算资源
- `ExecutionPlan` 应可完全落在 CPU 后端
- `WeightStore` 主要驻留在主存或映射文件中
- `TensorBuffer` 和 `KvCache` 主要位于 CPU 可访问内存

这个模式应重点保证：

- 正确性
- 内存利用率
- 多线程扩展性
- 调试友好性

### 6.2 纯 GPU realization

在纯 GPU 模式下：

- `ComputeDevice` 主要是 GPU 或 GPU 类执行资源
- `ExecutionPlan` 必须支持无 CPU 控制平面的推进
- `WeightStore` 需要支持 GPU 侧驻留视图
- `TensorBuffer` 与 `KvCache` 需要支持 GPU 侧长期存在

这个模式应重点保证：

- 控制流推进不依赖 CPU
- 元数据可被 GPU 侧维护
- 推理会话能在 GPU 侧持续存在
- 故障和资源回收有稳定表达

### 6.3 Hybrid realization

在 hybrid 模式下：

- `ComputeDevice` 包含 CPU 和 GPU
- `ExecutionPlan` 负责跨设备切分
- `PlacementPolicy` 负责主存与显存协同
- `WeightStore`、`TensorBuffer`、`KvCache` 支持分层驻留

这个模式应重点保证：

- 放置策略稳定
- 迁移可控
- 数据一致性明确
- 设备协同调度可观察

## 7. 资源治理

模型执行如果不上升到系统对象层，就无法做治理。  
因此模型底座必须支持资源治理，而不是只提供“能跑”的路径。

### 7.1 配额

建议至少支持：

- 权重驻留配额
- `KvCache` 配额
- 会话数限制
- 设备占用配额
- 输出吞吐限制

### 7.2 生命周期

模型底座必须能回答：

- 权重何时装入
- 会话何时创建
- 缓存何时释放
- 设备占用何时归还
- 编译后执行图何时失效

### 7.3 隔离

不同会话、不同 agent、不同执行域之间，需要明确：

- 哪些权重对象可共享
- 哪些缓存必须隔离
- 哪些设备上下文可共用
- 哪些对象只能通过 capability 访问

## 8. 模型底座服务

建议将模型底座拆成若干专门服务，而不是堆成单一大模块。

### 8.1 Weight Service

负责：

- 模型权重发现
- 校验
- 分片管理
- 装载与释放
- 只读共享

### 8.2 Buffer Service

负责：

- `TensorBuffer` 分配与释放
- 驻留状态跟踪
- 可迁移缓冲管理
- 同步与访问控制

### 8.3 Cache Service

负责：

- `KvCache` 分配与回收
- 会话绑定
- 淘汰与压缩策略
- 跨层放置协调

### 8.4 Session Service

负责：

- `InferenceSession` 生命周期
- 状态查询
- 取消、暂停、恢复
- 输出流路由

### 8.5 Device Scheduler

负责：

- 计算设备选择
- 设备队列调度
- 并发推理协调
- 设备配额管理

### 8.6 Plan Coordinator

负责：

- `ExecutionPlan` 构建
- `PlacementPolicy` 应用
- 后端选择
- 回退策略执行

## 9. 与执行域的关系

模型底座不是执行域，但执行域会消费模型底座。

### 9.1 Linux Domain

Linux domain 中的用户态推理框架，可以把模型底座看作一种系统服务接口。  
它不应该绕过底座直接把所有模型资源都藏在普通进程私有堆里。

### 9.2 Native Domain

Native domain 是最适合直接消费模型底座能力的通道。  
它可以使用更原生的对象句柄与 capability 语义，而不被 POSIX 模型束缚。

### 9.3 Inference Domain

Inference domain 应直接围绕模型底座设计。  
它是模型执行能力最自然的执行域，负责将 domain 级语义映射到底座对象：

- 创建会话
- 配置计划
- 调度执行
- 接收输出

### 9.4 Agent Domain

Agent domain 会在模型底座之上增加：

- 上下文编排
- 工具调用
- 记忆对象
- 权限控制
- 任务协作

因此 agent 不应直接绕过模型底座去操作底层张量和设备资源。

## 10. 与平台实现的关系

模型底座必须与 [docs/platform-realizations.md](/Users/hjr/Desktop/Kairo/docs/platform-realizations.md) 保持一致。

### 10.1 不变项

以下内容应跨 realization 保持稳定：

- `WeightStore`
- `TensorBuffer`
- `KvCache`
- `InferenceSession`
- `ExecutionPlan`
- `PlacementPolicy`

### 10.2 可变项

以下内容可以随 realization 改变：

- 实际内存布局
- 元数据承载方式
- 调度推进方式
- 编译后执行图格式
- 故障来源

### 10.3 核心要求

realization 的变化不应让上层执行域重新发明一套模型对象语义。  
否则纯 CPU、纯 GPU、hybrid 三条路径就会重新分裂成三套系统。

## 11. 推荐源码骨架方向

后续代码可以逐步引入如下结构：

```text
kairo-kernel/src/
├── substrate/
│   └── model/
│       ├── weight/
│       ├── buffer/
│       ├── cache/
│       ├── session/
│       ├── device/
│       └── plan/
```

这里的语义是：

- `weight/`：`WeightStore`、`WeightShard`
- `buffer/`：`TensorBuffer`
- `cache/`：`KvCache`
- `session/`：`InferenceSession`
- `device/`：`ComputeDevice`、调度接口
- `plan/`：`ExecutionPlan`、`PlacementPolicy`、`GraphExecutable`

早期可以先只建立空骨架和占位 trait，不必立刻做完整实现。

## 12. 当前阶段建议

结合当前仓库状态，模型底座设计现阶段最应该起到的作用，不是立刻提供完整推理能力，而是尽快防止架构继续退化为传统 OS 思路。

当前最建议先明确的是：

1. 权重是系统对象，不是普通文件
2. `KvCache` 是系统对象，不是普通堆内存
3. `InferenceSession` 是系统对象，不是普通进程
4. `ExecutionPlan` 是系统对象，不是运行时私有实现细节
5. 设备调度必须面向模型执行，而不是只停留在设备驱动层

## 13. 结论

Kairo 如果要真正支持 agent 与模型执行，就不能把推理能力留给普通用户态程序自行拼装。  
系统必须原生理解：

- 模型权重
- 张量缓冲
- 上下文缓存
- 推理会话
- 计算设备
- 执行计划

只有这些对象成为系统一等资源，Kairo 才可能同时满足：

- 纯 CPU 执行
- 纯 GPU 执行
- CPU/GPU 混合执行
- 多模型并发治理
- agent runtime 的稳定承载
