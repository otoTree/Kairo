# Kairo Wasm 执行域设计

本文档定义 Kairo 的 `WasmDomain`。  
在 Kairo 中，Wasm 不是一个普通文件格式，也不只是一个“方便跑插件的沙箱”，而是双层执行模型中的关键外执行域。

WasmDomain 的作用，是为系统提供：

- 可隔离的程序执行
- capability 约束下的工具调用
- 可审计的 agent 扩展路径
- 可重放、可治理的模块运行方式

它与 [docs/dual-execution.md](/Users/hjr/Desktop/Kairo/docs/dual-execution.md) 中的 `Sandboxed Execution` 对应。

## 1. 为什么是 WasmDomain

Kairo 需要一种外部执行边界，用于承载：

- 工具逻辑
- 受控扩展
- 资源访问
- 可验证任务执行

Wasm 非常适合做这件事，因为它具备：

- 指令规整
- 语义明确
- 可移植
- 确定性强
- 易于做能力边界
- 易于生成执行 trace

因此 Wasm 在 Kairo 中不应只是“支持一下”，而应被明确建模为执行域。

## 2. WasmDomain 的系统位置

WasmDomain 的位置可以概括为：

- 它是 `ExecutionDomain`
- 它主要承载 `Sandboxed Execution`
- 它消费系统服务
- 它受 capability 控制
- 它与 AgentDomain 深度协作

WasmDomain 不是：

- 模型内执行路径
- 核心机制的一部分
- 普通用户态 ABI 的等价替身

## 3. WasmDomain 的职责

WasmDomain 至少应负责：

- Wasm 模块装载
- 模块实例生命周期
- capability 绑定
- 导入函数与系统服务桥接
- 内存与表对象治理
- 执行 trace 记录
- 故障与 trap 映射

## 4. 核心对象

WasmDomain 需要围绕一组稳定对象工作。

### 4.1 `WasmModule`

表示一个可装载的 Wasm 模块对象。  
它应具备：

- 模块字节码
- 版本信息
- 校验信息
- 导入导出元数据
- 权限声明

### 4.2 `WasmInstance`

表示一个运行中的模块实例。  
它应绑定：

- 一个 `WasmModule`
- 一组 capability
- 一个实例内存视图
- 一组表、全局与导入绑定
- 一条执行 trace

### 4.3 `WasmCapability`

表示模块可访问的能力集合。  
WasmInstance 不应默认拥有文件、网络、设备或系统服务访问权，而应通过 capability 显式获得。

### 4.4 `WasmTrace`

表示模块执行的系统可见轨迹。  
它至少应支持：

- 模块入口
- 导入调用
- 导出结果
- trap / fault
- 资源访问事件

### 4.5 `WasmHostBinding`

表示 Wasm 导入接口与系统服务之间的桥接对象。  
它负责：

- 将 Wasm 导入函数映射到系统服务
- 执行 capability 检查
- 做参数与错误转换

## 5. 模块生命周期

WasmDomain 必须明确模块生命周期，而不是只提供“加载然后运行”。

### 5.1 装载

装载阶段负责：

- 校验模块格式
- 分析导入导出
- 绑定 capability 需求
- 准备实例模板

### 5.2 实例化

实例化阶段负责：

- 分配实例内存
- 绑定 host imports
- 创建 `WasmInstance`
- 初始化 trace

### 5.3 执行

执行阶段负责：

- 进入模块导出函数
- 调度执行
- 记录 trace
- 捕获 trap
- 返回结果

### 5.4 终止

终止阶段负责：

- 释放实例资源
- 写回必要审计信息
- 清理临时 capability
- 标记结果状态

## 6. capability 模型

WasmDomain 的关键价值之一，是把外部执行严格放在 capability 边界内。

### 6.1 原则

- 默认零权限
- 所有资源访问显式授权
- capability 最小化
- capability 可审计
- capability 可撤销

### 6.2 典型能力

可以逐步支持以下能力类型：

- 文件读取
- 文件写入
- 网络访问
- 设备访问
- 时间查询
- 名称服务查询
- 模型推理调用

### 6.3 与 AgentDomain 的关系

AgentDomain 不应直接把任意工具调用扔进 WasmDomain。  
正确流程应是：

1. AgentDomain 决定需要外部执行
2. 申请或选择 capability 集合
3. 创建 `ExecutionLease`
4. 在 WasmDomain 中实例化模块
5. 收集结果与 trace

## 7. 与系统服务的关系

WasmDomain 不应绕过系统服务直接碰底层核心状态。

### 7.1 文件能力

通过 File Service 暴露给 Wasm host binding。

### 7.2 名称能力

通过 Namespace Service 进行对象发现。

### 7.3 设备能力

通过 Device Service 暴露设备对象或设备操作。

### 7.4 网络能力

通过 Network Service 暴露受限网络访问。

这意味着 WasmDomain 是外执行边界，不是新的旁路内核接口。

## 8. 与双层执行的关系

WasmDomain 对应的是 `Sandboxed Execution`，但它与 `Parametric Execution` 不是敌对关系。

### 8.1 边界

- Parametric：在模型内部完成
- WasmDomain：在系统外执行边界中完成

### 8.2 典型协同路径

1. 模型内部做快速推导
2. 生成或选择 Wasm 模块
3. AgentDomain 申请 capability
4. WasmDomain 执行
5. trace 和结果回到 agent

### 8.3 Wasm 的双重角色

Kairo 中应明确允许 Wasm 有两种位置：

- `WASM-as-Weights`
- `WASM-as-Sandbox`

WasmDomain 只负责后者。

## 9. 与平台实现的关系

WasmDomain 是执行域，因此原则上应可跨：

- CPU realization
- GPU realization
- hybrid realization

但不同 realization 下的具体承载方式可能不同。

### 9.1 CPU realization

最适合作为 WasmDomain 的早期实现入口。

### 9.2 GPU realization

纯 GPU realization 下，WasmDomain 可能需要：

- 受限支持
- 桥接环境
- 或特定 host binding 模型

不应默认假定所有 Wasm host 行为都能直接无条件存在。

### 9.3 Hybrid realization

可以将：

- 控制与 host binding 落在 CPU
- 某些加速执行落在 GPU

但系统语义不应因此分裂。

## 10. trace 与审计

WasmDomain 的核心价值之一，是可审计性。

### 10.1 推荐 trace 对象

- `WasmTrace`
- `ImportCallEvent`
- `CapabilityUseEvent`
- `TrapEvent`
- `ExecutionResult`

### 10.2 原则

- trace 应与实例生命周期绑定
- 能力使用应可记录
- trap 与故障应可区分
- 返回结果应可重放验证

### 10.3 与 Agent trace 的区别

建议明确区分：

- `AgentDecisionTrace`
- `InternalExecutionTrace`
- `WasmTrace`

这样才能知道：

- agent 决定了什么
- 模型内执行了什么
- 外部模块实际做了什么

## 11. 推荐源码骨架方向

未来可逐步引入如下结构：

```text
kairo-kernel/src/domain/wasm/
├── mod.rs
├── module.rs
├── instance.rs
├── capability.rs
├── binding.rs
├── trace.rs
└── error.rs
```

语义上可理解为：

- `module.rs`：`WasmModule`
- `instance.rs`：`WasmInstance`
- `capability.rs`：权限控制
- `binding.rs`：导入函数与系统服务桥接
- `trace.rs`：执行轨迹与审计
- `error.rs`：trap 与域错误模型

## 12. 当前阶段建议

Kairo 当前还不需要完整实现 Wasm runtime，但必须尽早把以下几点定死：

1. Wasm 是执行域，不只是工具格式
2. WasmDomain 是外部受控执行边界
3. 所有系统能力通过 capability 暴露
4. WasmDomain 不绕过系统服务
5. agent 对外部工具调用应优先统一收敛到 WasmDomain

## 13. 结论

WasmDomain 在 Kairo 中的意义，不是“支持跑一类模块”，而是为整个系统提供一条受治理、可审计、可验证、可组合的外执行路径。

如果 Parametric Execution 代表模型内部的执行能力，  
那么 WasmDomain 就代表系统边界外部的受控执行能力。

这两者共同构成 Kairo 的双层执行基础。
