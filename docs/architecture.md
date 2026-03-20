# Kairo 架构设计

本文档用于统一 Kairo 的总体架构语言。  
它不再把 Kairo 描述为“传统操作系统的一种现代化变体”，而是将其定义为一个面向模型执行、模型内生 agent 行为、多执行域和多平台实现的系统平台。

## 1. 架构目标

Kairo 的总体架构需要同时满足以下目标：

1. 核心机制最小化
2. 对象模型稳定
3. 系统服务可替换
4. 执行域可并存
5. 模型执行原生化
6. 模型内生 agent 行为顶层化
7. 平台实现多样化
8. 不为传统兼容层保留主线地位

## 2. 总体模型

Kairo 当前推荐使用如下逻辑模型：

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
| - Native / Inference / Agent / Wasm                  |
| - Driver / Service                                   |
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

这个结构有三层非常关键的收敛：

- 执行域和平台实现分离
- 模型执行与模型内生 agent 行为升格为一级结构
- 双层执行成为连接模型与系统的关键桥梁

## 3. 核心机制层

核心机制层必须尽量小，并避免被传统兼容语义、传统线程/进程模型污染。

### 3.1 目标

核心机制层只负责：

- 对象引用入口
- 最小隔离语义
- 最小执行推进
- 事件与故障表示
- 最小权限检查

### 3.2 推荐对象

当前建议最早稳定的对象包括：

- `Handle`
- `Capability`
- `ExecutionUnit`
- `ProtectionDomain`
- `AddressSpace`
- `Channel`
- `Namespace`
- `FaultEvent`

## 4. 系统服务层

系统服务层负责提供高层能力边界，而不是简单作为“核心内部功能模块”存在。

### 4.1 Process Service

负责高层任务视图、退出与等待语义、资源继承、用户态可见身份。

### 4.2 File Service

负责路径解析、文件对象语义、文件描述符语义适配、挂载视图。

### 4.3 Namespace Service

负责名称绑定、对象发现、可见性控制、多域命名视图。

### 4.4 Device Service

负责设备对象注册、驱动绑定、设备节点暴露、设备生命周期。

### 4.5 Network Service

负责网络协议能力、网络资源治理及等价接口视图。

## 5. 执行域层

执行域用于定义“系统对外暴露什么样的运行环境语义”。  
执行域不是平台实现，也不是服务集合。

### 5.1 当前建议的执行域

- `NativeDomain`
- `InferenceDomain`
- `AgentDomain`
- `WasmDomain`
- `DriverDomain`
- `ServiceDomain`

### 5.2 关键边界

- Wasm 是域，不只是工具格式
- Agent 也是域，但不意味着外部系统替模型思考
- Inference 是域，不只是推理库调用约定

## 6. 模型执行底座

模型执行底座负责把以下资源提升为系统对象：

- 权重
- 张量缓冲
- KV cache
- 推理会话
- 计算设备
- 执行计划

## 7. 双层执行

系统必须同时支持两类执行：

### 7.1 Parametric Execution

逻辑在模型推理内部执行。

### 7.2 Sandboxed Execution

逻辑在模型外部受控环境中执行。

## 8. Agent Environment Layer

Kairo 不应构建一个厚重的外部 agent runtime 去替模型完成 think/review/action。  
外部层应退化为统一环境语义层，只负责：

- observation schema
- action surface
- capability surface
- lease surface
- context / memory surface
- 统一反馈与 trace

也就是说：

- 模型负责智能
- 系统负责现实

## 9. 平台实现层

Platform Realization 回答的问题不是“系统语义是什么”，而是“同一套系统语义由什么硬件承载”。

### 9.1 CPU Realization

适合 bring-up、调试和基础验证。

### 9.2 GPU Realization

纯 GPU realization 可能不存在通用 CPU 控制流，因此：

- 控制不能默认等于 CPU
- 执行不能默认等于 thread
- 故障不能默认等于 CPU trap

### 9.3 Hybrid Realization

CPU 和 GPU 协同承载：

- 推理执行
- 环境语义层
- 执行计划推进
- 系统控制

## 10. 当前阶段建议

在当前代码规模下，Kairo 最重要的不是尽快堆功能，而是尽快完成以下收敛：

1. 统一对象语言
2. 统一执行语言
3. 统一平台语言
4. 统一模型作为 agent 主体、外部层作为环境语义层的位置
5. 统一 Wasm 在系统中的双重角色
6. 明确放弃传统 Linux 兼容主线

## 11. 结论

Kairo 的统一架构方向可以概括为一句话：

> Kairo 不是一个“顺便支持 agent 的可扩展操作系统”，而是一个以模型执行、模型内生 agent 行为、双层执行和多平台 realization 为中心的系统平台。
