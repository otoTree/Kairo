# Kairo 对象模型设计

本文档定义 Kairo 的统一对象模型。  
它的作用是为整个系统提供一套稳定的基础语言，使核心机制、系统服务、执行域、模型底座和 agent runtime 在谈论系统对象时使用同一组概念。

## 1. 为什么需要统一对象模型

如果 Kairo 不先统一对象语言，而是让不同模块各自发展，很快就会出现以下问题：

- 传统兼容层把对象长成 POSIX 形状
- 模型底座把对象长成推理框架私有结构
- agent runtime 把对象长成应用层临时抽象
- 服务层和执行域层重复定义句柄、身份、资源、事件、错误

因此 Kairo 必须优先稳定一批跨层共享的基础对象。

## 2. 对象模型原则

### 2.1 对象优先于目录

Kairo 不是先决定模块目录，再让对象自然长出来；而应先定义核心对象，再决定代码组织方式。

### 2.2 对象优先于传统兼容视图

传统 process、fd、thread、path 等概念即使未来出现在桥接层中，也只能被视为域内视图，而不是系统底层真相。

### 2.3 引用必须统一

所有跨边界对象引用都应尽量通过统一入口完成，而不是在不同层传播裸指针、私有 id 或隐式全局状态。

### 2.4 权限必须显式

对象可见，不等于对象可操作。  
Kairo 的对象模型必须预留 capability 校验位置。

### 2.5 平台实现不应改变对象语义

同一个对象在 CPU、GPU、hybrid realization 下可以有不同承载方式，但它的系统语义不应因此断裂。

## 3. 对象分类

Kairo 当前可将对象分为四类：

### 3.1 核心对象

支撑整个系统的最基础对象：

- `Handle`
- `Capability`
- `ExecutionUnit`
- `ProtectionDomain`
- `AddressSpace`
- `Channel`
- `Namespace`
- `FaultEvent`

### 3.2 服务对象

由系统服务提供的高层对象：

- 文件对象
- 设备对象
- 网络端点
- 名称绑定对象

### 3.3 模型对象

由模型底座定义的对象：

- `WeightStore`
- `TensorBuffer`
- `KvCache`
- `InferenceSession`
- `ExecutionPlan`

### 3.4 agent 对象

由 agent runtime 定义的对象：

- `AgentInstance`
- `ContextObject`
- `MemoryStore`
- `ToolCapability`
- `ExecutionLease`

## 4. `Handle`

`Handle` 是对象的统一引用入口。  
它的目标是避免不同层到处传播对象裸引用或私有编号。

有了 `Handle`，Wasm 模块实例 id、agent 工具引用等都可以建立在统一对象入口之上，而不是各自发明底层引用方式。

## 5. `Capability`

`Capability` 表示对某类对象或某类操作的访问资格。

如果没有 `Capability`：

- 工具调用只能靠 prompt 约束
- 服务访问只能靠隐式信任
- 域边界无法真正落实权限
- agent runtime 无法统一治理副作用

## 6. `ExecutionUnit`

`ExecutionUnit` 是 Kairo 的最小执行实体。

它不应直接等价于：

- thread
- CPU 线程
- GPU kernel
- actor

这些都可以是某种 execution view，但不应是底层真相。

## 7. `ProtectionDomain`

`ProtectionDomain` 是 Kairo 的隔离边界对象。

### 7.1 为什么不用传统 process 作为底层真相

因为 Kairo 需要承载：

- 原生服务容器
- Wasm 实例组
- agent 实体
- 推理会话运行边界

这些都不天然等于传统进程。

### 7.2 作用

`ProtectionDomain` 用于表达：

- 资源可见性边界
- 权限边界
- 对象归属边界
- 错误和故障影响边界

## 8. `AddressSpace`

`AddressSpace` 表示一套地址可见性或等价隔离视图。

它不应被直接等同于传统 process 视图。  
多个 `ExecutionUnit` 可以共享同一个 `AddressSpace`，也可以由高层模型决定如何组织。

## 9. `Channel`

`Channel` 是 Kairo 的基础通信与事件交付对象。

它应用于：

- 跨域消息传递
- 服务请求与回复
- agent 协作
- 推理输出流
- 外执行结果回传

## 10. `Namespace`

`Namespace` 表示名称解析和对象可见性的边界。

Kairo 不应把“路径文件系统”当成唯一名称模型。  
传统路径只是 `Namespace` 的一种视图。

## 11. `FaultEvent`

`FaultEvent` 是 Kairo 的统一故障表达对象。

它不能只用 exception 或 trap 语言描述，因为 Kairo 需要跨：

- CPU realization
- GPU realization
- hybrid realization

## 12. 核心对象之间的关系

当前建议的基础关系如下：

```text
Handle -> Object
Capability -> Operation on Object
ExecutionUnit -> executes within ProtectionDomain
ProtectionDomain -> owns visibility and resource boundaries
AddressSpace -> attached to ProtectionDomain or equivalent scope
Channel -> connects objects/domains/services
Namespace -> resolves names to object views
FaultEvent -> reports abnormal execution or access outcomes
```

## 13. 高层对象如何建立在核心对象之上

### 13.1 服务对象

例如文件对象、设备对象，本质上仍应通过：

- `Handle`
- `Capability`
- `Namespace`

来暴露和治理。

### 13.2 模型对象

例如 `WeightStore`、`InferenceSession`，也不应绕开核心对象体系：

- 它们应有统一引用入口
- 应有可治理能力边界
- 应有可归属的保护域或可见边界

### 13.3 agent 对象

例如 `AgentInstance`、`ExecutionLease`，同样应建立在统一对象语义之上，而不是单独另起炉灶。

## 14. 与执行域的关系

执行域不重新定义底层对象，而是定义这些对象在域内如何呈现。

例如：

- WasmDomain 把某些句柄投影为受 capability 约束的 host object
- AgentDomain 把一组模型对象和执行许可组织成 agent 运行实体

## 15. 与平台实现的关系

平台实现可以改变承载方式，但不应改变对象语义。

### 15.1 CPU realization

更接近传统直觉：

- `ExecutionUnit` 对应线程上下文
- `AddressSpace` 对应虚拟地址空间

### 15.2 GPU realization

需要更抽象的理解：

- `ExecutionUnit` 可能是 dispatch 单元
- `AddressSpace` 可能是等价可见性结构
- `FaultEvent` 可能来自执行图或设备故障

## 16. 结论

Kairo 的对象模型是整套系统语言的地基。  
如果这层没有统一，执行域、模型底座、Wasm、agent runtime 最终都会各自长出一套私有“真相”。
