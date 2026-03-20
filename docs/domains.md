# Kairo 执行域设计

本文档定义 Kairo 的 `ExecutionDomain` 模型，并统一各类域在系统中的位置。  
执行域是 Kairo 对外暴露运行环境语义的主要方式，它既不是平台实现，也不是系统服务，更不是传统意义上的“用户态应用类别”。

## 1. 执行域的作用

执行域用于回答以下问题：

- 用户程序或系统组件看到的运行环境语义是什么
- 程序如何装载和进入执行
- 错误如何表达
- 哪些对象可见
- 哪些系统服务可被访问
- 高层任务、会话、模块等概念如何映射到底层对象

因此，执行域是连接“统一核心对象模型”和“外部运行时人格”的桥梁。

## 2. 执行域与其他层的区别

### 2.1 与 Core Mechanisms 的区别

核心机制定义系统最稳定的内部语义，例如：

- `Handle`
- `Capability`
- `ExecutionUnit`
- `ProtectionDomain`
- `Channel`
- `FaultEvent`

执行域不能绕过这些对象自行发明底层真相。

### 2.2 与 System Services 的区别

系统服务提供能力边界，例如：

- 文件能力
- 名称能力
- 设备能力
- 网络能力

执行域决定如何看待和消费这些能力，而不是直接等价于这些服务本身。

### 2.3 与 Platform Realizations 的区别

平台实现回答“谁承载系统语义”，执行域回答“对外暴露什么环境语义”。  
同一个域可以在 CPU、GPU 或 hybrid realization 上承载。

## 3. 执行域的统一定义

一个执行域至少应定义以下内容：

- ABI 或调用面
- Loader 约定
- Error Model
- Object View
- Resource Policy
- Task Mapping
- Event Model
- Service Contract

其中最关键的是：

- 执行域可以定义自己的外部语义
- 但执行域不能改变系统底层对象真相

## 4. 核心对象与执行域的关系

当前建议将关系理解为：

- `ExecutionUnit`：最小执行实体
- `ProtectionDomain`：隔离边界
- `AddressSpace`：地址或等价隔离视图
- `Handle`：对象引用入口
- `Capability`：访问资格
- `Channel`：跨边界通信

执行域的职责，是把自己的高层概念投影到这些对象上。

例如：

- Wasm instance 是外部沙箱对象的一种域视图
- Inference session 是模型底座对象在特定域中的执行视图
- AgentInstance 是高层运行实体在域内组织后的视图

## 5. 执行域应具备的能力

一个成熟的执行域，至少应具备以下组成。

### 5.1 Loader

负责：

- 装载程序或模块
- 建立初始上下文
- 组织入口参数
- 初始化域内对象视图

### 5.2 Entry Gateway

负责：

- 接收域内入口调用
- 解析调用参数
- 将调用转为核心对象或服务请求
- 做域内错误映射

### 5.3 Object Mapper

负责：

- 域对象与核心对象的映射
- 域内编号与系统句柄映射
- 域内对象可见性

### 5.4 Event Adapter

负责：

- 把核心事件映射为域内可理解事件
- 定义阻塞、唤醒、异步通知或故障表达

### 5.5 Policy Adapter

负责：

- 资源访问规则
- 对象继承与共享
- 服务可见性
- capability 要求

## 6. 推荐的 trait 方向

这里只表达架构方向，不规定最终代码签名。

```rust
pub trait ExecutionDomain {
    type Error;
    type TaskView;
    type ObjectView;

    fn name(&self) -> &'static str;
    fn create_initial_context(&self, image: &ExecutableImage) -> Result<DomainContext, Self::Error>;
    fn handle_entry(&self, entry: DomainEntry) -> DomainResult;
    fn map_object(&self, handle: Handle) -> Result<Self::ObjectView, Self::Error>;
    fn deliver_event(&self, target: &Self::TaskView, event: DomainEvent) -> Result<(), Self::Error>;
}
```

## 7. 当前建议的执行域集合

Kairo 当前建议明确建模以下执行域：

- `NativeDomain`
- `InferenceDomain`
- `AgentDomain`
- `WasmDomain`
- `DriverDomain`
- `ServiceDomain`

## 8. NativeDomain

NativeDomain 是 Kairo 原生运行时语义的保留位。

### 8.1 存在意义

它的作用，是为更直接、更面向对象和 capability-first 的运行时提供空间。

### 8.2 可能特征

- 显式句柄传递
- capability-first
- 面向 channel 的调用方式
- 更直接的服务发现
- 不以传统文件系统为唯一世界观

## 9. InferenceDomain

InferenceDomain 是模型执行能力的主要执行域。

### 9.1 作用

它负责把模型底座对象组织成对外可消费的推理运行环境。

### 9.2 典型对象视图

- `WeightStore`
- `TensorBuffer`
- `KvCache`
- `InferenceSession`
- `ExecutionPlan`

### 9.3 职责

负责：

- 创建和管理推理会话
- 配置执行计划
- 绑定计算设备
- 发起推理执行
- 接收输出流和故障信息

## 10. AgentDomain

AgentDomain 用于承载 agent 的高层运行语义，而不是让 agent 退化成普通进程集合。

### 10.1 典型对象

- `AgentInstance`
- `ContextObject`
- `MemoryStore`
- `ToolCapability`
- `TaskMailbox`
- `ExecutionLease`

### 10.2 作用

负责：

- 上下文编排
- 记忆管理
- 工具权限控制
- 任务协作
- 执行策略选择

### 10.3 与双层执行的关系

AgentDomain 不应自己直接包办所有执行。  
它应作为双层执行的主要编排者：

- 选择 Parametric Execution
- 选择 Sandboxed Execution
- 管理结果回写与 trace 绑定

## 11. WasmDomain

WasmDomain 是 Kairo 中最重要的外部沙箱执行域之一。  
它不只是“能跑 wasm 模块”，而是承载：

- 受 capability 约束的程序执行
- agent 工具调用
- 可审计扩展
- 可重放任务运行

WasmDomain 的详细设计单独见 [docs/wasm-domain.md](/Users/hjr/Desktop/Kairo/docs/wasm-domain.md)。

## 12. DriverDomain

DriverDomain 用于避免设备驱动永远内嵌在核心中不可拆分。

### 12.1 作用

负责：

- 消费设备枚举
- 与 Device Service 协作
- 响应 I/O 或设备事件
- 暴露设备端点

## 13. ServiceDomain

ServiceDomain 承载系统服务组件的运行形态。

### 13.1 典型服务

- Process Service
- File Service
- Namespace Service
- Device Service
- Network Service

## 14. 跨域交互原则

为了避免执行域退化成目录层面的概念，Kairo 应尽早明确跨域交互规则。

### 14.1 原则

- 所有跨域交互都通过显式对象或显式通道
- 默认不共享对象可见性
- 优先传递句柄或 capability
- 错误语义在域边界转换

### 14.2 例子

Agent 请求工具调用：

1. AgentDomain 评估权限与策略
2. 选择进入 WasmDomain
3. WasmDomain 执行模块
4. 结果与 trace 返回给 AgentDomain

## 15. 结论

Kairo 的执行域模型不是为了把传统 ABI 拆成更多目录，而是为了确保：

- Wasm 有正确位置
- 推理有正确位置
- agent 有正确位置
- 平台变化不会打散外部运行环境语义
