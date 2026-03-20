# Kairo 参数内执行设计

本文档定义 Kairo 的 `Parametric Execution` 路线。  
它关注的问题不是“如何运行外部程序模块”，而是更激进的一类能力：

如何让某些程序逻辑以内化到模型参数、模型内部执行器或推理快路径的形式存在，并在模型推理过程中直接执行。

在 Kairo 的整体架构中，`Parametric Execution` 对应 [docs/dual-execution.md](/Users/hjr/Desktop/Kairo/docs/dual-execution.md) 中的内执行层，并与 `WASM-as-Weights` 直接相关。

## 1. 问题定义

Kairo 的双层执行模型中，`Sandboxed Execution` 负责：

- 外部受控执行
- capability 边界
- 审计与重放
- 工具与系统服务接入

但并不是所有计算都值得走外部执行路径。  
对某些任务来说，外部执行过重，因为它需要：

- 跨边界传参
- host binding
- 生命周期管理
- trace 注入与结果回传

对于高频、短程、机械、结构化的计算，更合理的做法是：

- 让这类逻辑直接在模型推理过程中被执行
- 避免完整的外部往返
- 保留统一的执行编排能力

这就是 `Parametric Execution` 的问题空间。

## 2. Parametric Execution 不是“把源码喂给模型”

一个常见误解是：

- 只要把某段解释器源码加入训练语料
- 模型就等于“获得了这个解释器”

这并不准确。

对 Kairo 而言，真正相关的不是“模型记住了解释器源码”，而是：

- 模型是否学会了状态转移规律
- 模型是否能在给定程序和输入的情况下，逐步推进执行状态
- 模型是否能稳定输出正确的执行 trace

因此，`Parametric Execution` 的核心不是“源码进入语料”，而是：

> 把程序执行表示为模型可学习、可推进、可压缩的状态转移过程。

## 3. 为什么选择 Wasm 作为参数内执行的主要 IR

Kairo 当前最自然的选择，不是直接把任意高级语言拿来做参数内执行，而是优先围绕 Wasm。

### 3.1 优势

Wasm 很适合做参数内执行的中间表示，因为它具备：

- 指令规整
- 栈机语义明确
- 确定性强
- 易于 token 化
- 易于 trace 化
- 易于裁剪子集

### 3.2 与 Kairo 的架构一致性

在 Kairo 中，Wasm 已经有外执行位置：

- `WASM-as-Sandbox`

如果参数内执行也围绕 Wasm 展开，就能形成：

- `WASM-as-Weights`
- `WASM-as-Sandbox`

这会让系统在内执行和外执行之间共享同一类程序表示，而不是维护两套完全不同的程序世界。

## 4. 参数内执行的基本模型

Kairo 当前更适合采用：

- append-only execution trace
- 明确状态重述
- 局部历史回看

而不是假定模型拥有传统计算机那种可变内存。

### 4.1 为什么是 trace

transformer 的自然运行方式是：

- 给定输入前缀
- 回看历史 token
- 生成下一个 token

因此更适合把执行表示为：

- 程序 token
- 输入 token
- 逐步追加的执行轨迹 token

### 4.2 不是“修改状态”，而是“重述状态变化”

传统解释器会原地更新：

- 栈
- 内存
- 指令指针

而参数内执行更适合这样表示：

- 当前执行了哪条指令
- 栈发生了什么变化
- 内存发生了什么变化
- 控制流跳转是否发生
- 是否输出结果

也就是：

- 状态变化被写成 trace
- 模型通过回看 trace 恢复当前状态

## 5. 最小 Wasm 子集

Kairo 不应一开始就追求完整 Wasm 语义。  
参数内执行更适合从可控子集开始。

### 5.1 建议第一阶段子集

优先支持：

- `i32.const`
- `i32.add`
- `i32.sub`
- `i32.mul`
- `local.get`
- `local.set`
- `local.tee`
- `drop`
- `select`
- `br`
- `br_if`
- `return`
- `i32.load`
- `i32.store`

### 5.2 暂缓内容

先不急于支持：

- 浮点
- 复杂 table / indirect call
- 多内存模型
- 复杂 host import
- 线程相关扩展

### 5.3 原因

第一阶段的目标不是“参数内执行完整 Wasm”，而是：

- 验证 trace machine 是否稳定
- 验证状态编码是否合理
- 验证它与双层执行是否能协同

## 6. 执行状态如何编码

Kairo 的参数内执行至少需要显式表示以下几类状态。

### 6.1 Program Counter 视图

至少需要知道：

- 当前执行到哪条指令
- 下一步将解释哪个 opcode

### 6.2 Stack Delta

对于 Wasm 栈机，最关键的是：

- 压栈了什么
- 出栈了什么
- 结果值是什么

与其完整重述整个栈，更适合先编码：

- 栈变化
- 栈高度变化
- 关键值输出

### 6.3 Local State

至少需要可表示：

- 哪个 local 被读
- 哪个 local 被写
- 写入值是什么

### 6.4 Memory Delta

对于 load/store，需要编码：

- 访问地址
- 访问宽度
- 读出或写入值

### 6.5 Control Delta

对于 branch 和 return，需要编码：

- 分支是否 taken
- 返回是否发生
- 执行是否 halt

## 7. 推荐 trace 形态

当前建议把执行轨迹视为结构化 token 序列，而不是普通自然语言解释。

### 7.1 基本块

每一步轨迹至少包含：

- `pc`
- `opcode`
- `stack_delta`
- `local_delta?`
- `memory_delta?`
- `control_delta`

### 7.2 示例风格

例如非常简化的风格：

```text
pc=0 op=i32.const push=3
pc=1 op=i32.const push=5
pc=2 op=i32.add pop=2 push=8
pc=3 op=return out=8 halt
```

这只是示意，最终未必要用这种可读文本格式，但语义结构应接近。

### 7.3 为什么不直接输出最终结果

如果只训练：

- 程序 + 输入 -> 最终输出

那模型学到的是黑盒映射，而不是执行能力。  
Kairo 需要的是：

- 可推进
- 可观察
- 可调试
- 可与外执行统一编排

因此 trace 是核心，而不是副产品。

## 8. 参数内解释器的训练目标

### 8.1 最小监督形式

最基础的数据形式应是：

- 输入：程序 + 输入
- 目标：执行轨迹

### 8.2 进阶监督

后续可以进一步加入：

- 错误轨迹
- trap 轨迹
- 局部修正目标
- 计划与执行分离目标

### 8.3 为什么这比“让模型学会 Wasm”更强

因为这里训练的不是语义描述能力，而是：

- 真实状态推进能力
- 真实执行追踪能力
- 真实控制流选择能力

## 9. 参数内执行与模型底座的关系

`Parametric Execution` 不是独立的完整系统层，它必须建立在模型底座之上。

### 9.1 依赖对象

它会直接依赖：

- `InferenceSession`
- `ExecutionPlan`
- `TensorBuffer`
- `KvCache`

### 9.2 典型流程

1. Agent 或 InferenceDomain 识别某段逻辑适合内执行
2. 构造程序表示和输入表示
3. 创建或复用推理会话
4. 模型在 trace mode 下推进执行
5. 返回 `InternalExecutionTrace`

## 10. 参数内执行与外执行的边界

Kairo 必须明确哪些逻辑适合内执行，哪些必须外执行。

### 10.1 适合 Parametric Execution 的任务

- 高频小计算
- 结构化求值
- 低副作用逻辑
- 短程解释执行
- 需要和模型推理紧耦合的中间计算

### 10.2 不适合 Parametric Execution 的任务

- 文件写入
- 网络访问
- 设备访问
- 长生命周期系统资源持有
- 需要强审计和强权限控制的动作

### 10.3 原则

如果某个逻辑涉及外部副作用或强治理要求，就应优先进入 `WasmDomain`，而不是强行内化。

## 11. 与 WasmDomain 的协同

参数内执行不是要替代 WasmDomain，而是与其形成分工。

### 11.1 内执行负责

- 低延迟
- 高频
- 机械
- 可训练

### 11.2 WasmDomain 负责

- 隔离
- capability
- 审计
- 外部资源访问
- 可重放执行

### 11.3 统一路径

推荐的统一编排路径是：

1. Agent Runtime 决定任务策略
2. 某些前置计算走 Parametric Execution
3. 真正需要副作用的部分走 WasmDomain
4. trace 统一回收进 agent 状态

## 12. 与平台实现的关系

参数内执行必须兼容 Kairo 的三类 realization。

### 12.1 CPU realization

适合作为最早实验平台：

- 最容易调试
- 最容易验证 trace 正确性
- 最容易做最小 executor model

### 12.2 GPU realization

长期很重要，因为：

- 参数内执行天然发生在模型推理路径中
- 如果模型执行本身在 GPU 上，内执行就很适合与 GPU realization 结合

### 12.3 Hybrid realization

最现实的长期路线：

- 常规推理在 GPU
- 编排和部分治理在 CPU
- 内执行作为推理快路径的一部分

## 13. 推荐源码骨架方向

未来可逐步引入如下结构：

```text
kairo-kernel/src/substrate/parametric/
├── mod.rs
├── trace.rs
├── wasm_ir.rs
├── executor.rs
├── encoding.rs
└── policy.rs
```

语义上可理解为：

- `trace.rs`：`InternalExecutionTrace`
- `wasm_ir.rs`：参数内执行用的 Wasm 子集表示
- `executor.rs`：参数内执行抽象
- `encoding.rs`：程序与状态的 token 编码
- `policy.rs`：何时走参数内执行的策略

## 14. 推荐实验路线

如果要从研究验证角度推进，建议顺序如下：

### 14.1 第一步：最小 Wasm 子集数据集

生成：

- 小程序
- 输入
- 标准执行 trace

### 14.2 第二步：小型 executor transformer

目标不是自然语言，而是：

- 输入程序和输入值
- 输出执行 trace

### 14.3 第三步：fast path / slow path 分离

先不要把它直接和大模型完全融合。  
可以先做：

- 大模型负责规划
- 小 executor 模型负责 trace 执行

### 14.4 第四步：接入 Kairo 双层执行

最终把它接进：

- `InferenceDomain`
- `AgentRuntime`
- `WasmDomain`

形成统一执行编排。

## 15. 当前阶段建议

Kairo 当前不需要立刻完整实现参数内执行，但必须尽早统一以下判断：

1. 参数内执行的重点是状态推进，不是源码记忆
2. Wasm 是最自然的参数内执行 IR
3. trace 是核心产物，不是附属日志
4. 参数内执行只负责低副作用计算
5. 它必须与 WasmDomain 共存，而不是取代 WasmDomain

## 16. 结论

Kairo 的 `Parametric Execution` 路线，不是为了让模型“看起来更会算”，而是为了把一部分高频、机械、结构化的程序逻辑，真正内化进模型执行路径。

如果 `WasmDomain` 代表的是受控外执行，  
那么 `Parametric Execution` 代表的就是模型内部可训练、可推进、低延迟的程序执行能力。

它们共同构成 Kairo 双层执行模型的两端。
