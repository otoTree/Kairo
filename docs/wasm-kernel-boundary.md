# Kairo Wasm 与系统内核边界设计

本文档用于回答一个容易被混淆、但对 Kairo 非常关键的问题：

什么样的系统逻辑适合被封装为 Wasm 模块，进入 `WasmDomain` 或参数内执行路径；什么样的逻辑绝不能被 Wasm 化，而必须留在更底层的核心机制、系统服务或平台实现中。

这份文档的目的，不是简单讨论“Wasm 能不能跑内核”，而是为 Kairo 划清：

- Wasm 的正确系统位置
- Wasm 与核心机制的边界
- Wasm 与系统服务的边界
- Wasm 与参数内执行的边界

## 1. 先澄清：不能把“整个传统内核”做成普通 Wasm 模块

如果这里说的“内核”是指传统最底层系统能力，例如：

- 启动
- 特权级切换
- 中断与异常入口
- 页表建立与切换
- 最小调度推进
- 设备寄存器直接控制
- 故障隔离的最终裁决

那么这些能力不能被简单封装成普通 Wasm 模块。

原因不是“Wasm 不够强”，而是：

- Wasm 默认是受宿主控制的
- Wasm 默认位于受限执行边界中
- Wasm 默认不能成为整台机器的最终控制者

因此：

> Kairo 不应把“传统意义上的底层 kernel”直接当作 Wasm 模块来设计。

## 2. 正确的问题不是“内核能不能变成 Wasm”，而是“哪些系统逻辑应该 Wasm 化”

Kairo 更合理的思考方式是把系统逻辑分成三层：

1. 不可 Wasm 化的底层核心
2. 可服务化但不应 Wasm 化的系统能力
3. 适合 Wasm 化的系统逻辑

如果这三层不分清，Wasm 会在系统里要么太弱，要么乱入太深。

## 3. 第一类：不可 Wasm 化的底层核心

以下逻辑应明确留在 `Core Mechanisms`、`Platform Realizations`、`arch/boot` 一侧，而不是交给 Wasm。

### 3.1 启动与平台 bring-up

包括：

- 启动入口
- 平台初始化
- 最小内存可用性建立
- 最小控制台
- 基本故障路径建立

这些能力必须先于任何 Wasm 模块存在。

### 3.2 最终隔离语义

包括：

- `ProtectionDomain` 的最终裁决
- capability enforcement 根基
- 对象可见性根基

Wasm 可以消费这些边界，但不能定义这些边界。

### 3.3 最终故障处理权

包括：

- `FaultEvent` 的最终来源与捕获
- 致命故障时系统如何裁决

Wasm 可以报告 fault，但不能决定系统最终的故障语义。

### 3.4 平台特权控制

例如：

- 低层设备寄存器访问
- 中断控制器
- 页表 / MMU 级别控制
- 最终 trap/exception 路径

这些都必须由更低层持有。

## 4. 第二类：可服务化但不应 Wasm 化的系统能力

有些能力虽然不是最底层核心，但也不适合直接变成 Wasm 模块本体。

### 4.1 系统对象真相

以下对象的真实定义不应由 Wasm 模块承担：

- `Handle`
- `Capability`
- `ExecutionUnit`
- `ProtectionDomain`
- `Channel`
- `Namespace`

Wasm 可以消费这些对象，但不应重新定义它们。

### 4.2 系统服务主语义

例如：

- File Service 的最终对象模型
- Namespace Service 的最终绑定规则
- Device Service 的最终设备权限规则

Wasm 可以承载某些策略、适配器或扩展，但不应成为这些服务真相的唯一实现。

### 4.3 agent runtime 的最终治理语义

例如：

- `ToolCapability` 的最终裁决
- `ExecutionLease` 的最终签发
- `AgentInstance` 的最终生命周期规则

Wasm 可以作为工具和策略模块，但不能成为整个 agent runtime 的治理根基。

## 5. 第三类：适合 Wasm 化的系统逻辑

这类逻辑既不是硬件主权，也不是系统对象真相，但很适合利用 Wasm 的：

- 隔离
- 可移植
- 可审计
- 可重放
- 可裁剪能力

### 5.1 工具逻辑

这是最典型的一类：

- 文本处理
- 数据转换
- 结构化计算
- 外部 API 适配器
- 受控业务逻辑

### 5.2 系统扩展模块

例如：

- 可替换的策略逻辑
- 某些服务扩展点
- 可插拔规则引擎
- 可替换数据面逻辑

### 5.3 可验证执行单元

例如：

- 需要 trace
- 需要审计
- 需要重放
- 需要 capability 边界

的执行逻辑，都很适合放进 Wasm。

### 5.4 可移植系统组件

如果一段系统逻辑希望：

- 跨 CPU / GPU / hybrid 一致
- 不直接依赖平台特权
- 容易热替换

那么 Wasm 很可能是合理封装方式。

## 6. Kairo 中 Wasm 的三种正确位置

在 Kairo 中，Wasm 不应只有一种位置。  
更合理的是承认它至少可能有三种角色。

### 6.1 `WASM-as-Sandbox`

这是 [docs/wasm-domain.md](/Users/hjr/Desktop/Kairo/docs/wasm-domain.md) 讨论的主位置：

- 外部受控执行
- 工具承载
- capability 边界
- trace / 审计

### 6.2 `WASM-as-Weights`

这是 [docs/parametric-execution.md](/Users/hjr/Desktop/Kairo/docs/parametric-execution.md) 讨论的位置：

- 作为模型内执行的中间表示
- 作为参数内执行 IR
- 作为 trace machine 的程序格式

### 6.3 `WASM-as-System-Extension`

这是本文件强调的一层：

- 作为系统逻辑的模块化载体
- 既不是底层内核
- 也不只是普通 agent 工具
- 而是可被系统服务或 agent runtime 调用的受控扩展模块

## 7. Wasm 不能做什么

为了防止系统边界漂移，Kairo 需要明确写死几条禁止性判断。

### 7.1 Wasm 不能成为最终权限裁决者

Wasm 模块不能自行定义：

- capability 是否有效
- 哪个对象最终可访问
- 哪个域最终可见哪些资源

### 7.2 Wasm 不能成为最终平台主权持有者

Wasm 模块不能承担：

- 最终硬件控制
- 最终启动路径
- 最终 trap / fault 主权

### 7.3 Wasm 不能成为系统对象真相

Wasm 可以操作对象视图，但不应定义：

- `Handle` 的本体
- `ProtectionDomain` 的本体
- `ExecutionUnit` 的本体

### 7.4 Wasm 不能绕过系统服务

Wasm 模块不能直接作为旁路接口碰系统底层状态。  
所有能力都应通过：

- File Service
- Namespace Service
- Device Service
- Network Service

等受控路径暴露。

## 8. Wasm 能做什么

对应地，Kairo 也应明确 Wasm 的强项。

### 8.1 受控工具执行

这是最自然的使用方式。

### 8.2 可审计策略执行

适合：

- 规则判断
- 工作流子步骤
- 结构化业务逻辑

### 8.3 可验证系统扩展

适合：

- 服务扩展
- 插件
- 可替换模块

### 8.4 可移植中间程序表示

这同时支持：

- 外执行
- 参数内执行
- 双层执行共享程序表示

## 9. 与系统服务的边界

Wasm 在 Kairo 中不能直接“成为服务真相”，但可以成为服务扩展体。

### 9.1 File Service

正确方式：

- File Service 定义文件对象和权限边界
- Wasm 模块通过 host binding 消费文件能力

错误方式：

- 用 Wasm 模块定义整个文件对象模型

### 9.2 Namespace Service

正确方式：

- Namespace Service 负责对象发现和名称绑定
- Wasm 模块通过受限方式查询或解析对象

错误方式：

- 让 Wasm 模块决定全系统名称规则

### 9.3 Device Service

正确方式：

- Device Service 定义设备对象和访问策略
- Wasm 模块消费受控设备能力

错误方式：

- 让 Wasm 模块直接持有最终设备主权

## 10. 与 Agent Runtime 的边界

Agent Runtime 和 Wasm 容易混淆，因为很多 agent 工具最终都会落在 WasmDomain。

### 10.1 Agent Runtime 不等于 Wasm 工具集合

Agent runtime 负责的是：

- 决策
- 编排
- 租约
- 上下文
- 记忆
- 治理

Wasm 只是它的一种执行载体。

### 10.2 正确关系

建议理解为：

- Agent Runtime 决定是否需要外执行
- WasmDomain 承担受控执行
- Wasm 模块承载具体逻辑

### 10.3 错误关系

错误做法是：

- 把 agent runtime 整体做成一组 Wasm 模块
- 让工具模块自行决定权限和治理边界

## 11. 与 Parametric Execution 的边界

Kairo 的独特点之一，是 Wasm 同时可能出现在内执行和外执行两边。  
所以必须明确边界。

### 11.1 适合 `WASM-as-Weights` 的逻辑

- 高频
- 低副作用
- 结构化
- 可 trace 化
- 可训练

### 11.2 适合 `WASM-as-Sandbox` 的逻辑

- 有外部资源访问
- 有副作用
- 需要审计
- 需要重放
- 需要 capability 边界

### 11.3 关键判断

一段逻辑如果：

- 更像“计算”

更适合往 `Parametric Execution` 收；

如果：

- 更像“动作”

更适合往 `WasmDomain` 收。

## 12. 与平台实现的边界

Wasm 不能替代 platform realization。

### 12.1 CPU realization

最适合作为 Wasm 的早期执行承载。

### 12.2 GPU realization

Wasm 在纯 GPU realization 下可能仍可存在，但要注意：

- 不能假定所有 host binding 天然存在
- 不能假定外执行路径和 CPU 下一样容易落地

### 12.3 Hybrid realization

最现实的长期路径是：

- Wasm 执行和 host binding 主要先落在 CPU
- 模型执行主要落在 GPU
- agent runtime 统一编排二者

## 13. 推荐的系统判断清单

以后每当要把某段逻辑做成 Wasm，都可以先问这几个问题：

1. 这段逻辑是否涉及最终权限裁决？
2. 这段逻辑是否涉及最终平台主权？
3. 这段逻辑是否定义系统对象真相？
4. 这段逻辑是否需要副作用治理和审计？
5. 这段逻辑更像“计算”还是更像“动作”？

如果前 3 个有任意一个答案是“是”，就不应 Wasm 化。  
如果后 2 个答案分别偏向“需要治理”和“更像动作”，就更适合 `WasmDomain`。  
如果偏向“纯计算”，就更适合进一步评估是否进入 `Parametric Execution`。

## 14. 当前阶段建议

Kairo 当前最适合的 Wasm 边界策略是：

1. 不讨论“把整个内核做成 Wasm”
2. 先把 Wasm 视为受控外执行边界
3. 再把 Wasm 视为参数内执行 IR
4. 最后才逐步探索 Wasm 作为系统扩展模块的更深用法

这个顺序能最大程度避免边界混乱。

## 15. 结论

Kairo 中最关键的不是“Wasm 能不能做很多事”，而是：

- 它不能替代核心机制
- 它不能替代系统主权
- 它不能定义系统对象真相

但同时：

- 它非常适合承载受控外执行
- 它非常适合作为参数内执行 IR
- 它非常适合作为系统扩展模块格式

只有把这三层位置区分清楚，Wasm 在 Kairo 中才不会变成一个既万能又失控的模糊概念。
