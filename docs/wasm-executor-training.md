# Kairo Wasm 执行器训练设计

本文档定义 Kairo 的 `Wasm Executor Training` 路线。  
它关注的目标不是“让模型看起来懂一些 Wasm”，而是更强的目标：

让模型内化足够通用的 Wasm 执行语义，使其能够对大范围未见过的 Wasm 程序进行稳定解释执行。

这份文档与以下文档直接相关：

- [docs/parametric-execution.md](/Users/hjr/Desktop/Kairo/docs/parametric-execution.md)
- [docs/model-substrate.md](/Users/hjr/Desktop/Kairo/docs/model-substrate.md)
- [docs/dual-execution.md](/Users/hjr/Desktop/Kairo/docs/dual-execution.md)
- [docs/wasm-domain.md](/Users/hjr/Desktop/Kairo/docs/wasm-domain.md)
- [docs/wasm-kernel-boundary.md](/Users/hjr/Desktop/Kairo/docs/wasm-kernel-boundary.md)

## 1. 训练目标

Kairo 这里追求的不是：

- 让模型背下很多 Wasm 程序样例
- 让模型从程序直接猜最终结果

而是：

> 给定 Wasm 程序、输入状态和历史执行轨迹，模型能够稳定地产生下一步正确的执行状态变化。

更完整地说：

> Kairo 追求让模型内化 Wasm 的通用执行语义，使其能够对大范围未见过的 Wasm 程序进行稳定解释执行；对超长、强副作用或强环境依赖程序，则通过 `WasmDomain` 提供外部受控执行路径。

## 2. 目标边界

这个训练目标必须明确边界，否则“任意程序都能运行”会失去可操作性。

### 2.1 当前目标

当前目标是：

- 学会通用 Wasm 语义
- 学会对未见过程序执行
- 学会长程 trace 推进
- 学会区分正常执行、halt 和 trap

### 2.2 当前不追求

当前不追求：

- 无限长程序
- 无限长执行
- 完整外部环境模拟
- 任意 host import 语义
- 一次性覆盖所有 Wasm 扩展

### 2.3 与系统目标的关系

这并不是退让，而是和 Kairo 的双层执行一致：

- 通用 Wasm 语义尽量内化
- 复杂环境交互交给外部 `WasmDomain`

## 3. 总体训练思路

最基础的思路是：

1. 定义 Wasm 子集
2. 为该子集生成大量程序
3. 用参考解释器跑出标准执行 trace
4. 训练模型预测 trace
5. 用 verifier 检查逐步正确性
6. 逐步扩展复杂度和长度

这里最关键的是：

- 训练的中心不是 final output
- 而是 execution trace

## 4. 训练任务定义

### 4.1 最基础任务

输入：

- Wasm 程序
- 输入值或初始内存
- 可选执行模式标记

输出：

- 标准化 execution trace

### 4.2 更强任务

后续可增加：

- next-step trace prediction
- trap prediction
- invariant prediction
- self-repair
- verifier-guided correction

### 4.3 为什么不用 `program -> answer`

因为那样训练出来的往往是：

- 黑盒映射器
- 不是解释器

而 Kairo 要的是：

- 可观察
- 可校验
- 可与外执行统一编排

## 5. Wasm 子集设计

训练必须从受限 Wasm 子集开始，而不是一口气追求完整 Wasm。

### 5.1 第一阶段建议子集

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

### 5.2 第二阶段扩展

再逐步加入：

- `call`
- 简单函数调用
- 嵌套 block / loop
- 有限递归
- 更复杂 memory pattern

### 5.3 暂缓内容

先不急于支持：

- 浮点
- 复杂 table / indirect call
- 线程扩展
- 多内存扩展
- 复杂 host import

## 6. Trace 设计

trace 设计直接决定训练稳定性。

### 6.1 核心原则

- 结构稳定
- 字段固定
- 低歧义
- 可校验
- 可机读

### 6.2 每步建议字段

每一步 trace 建议至少包含：

- `pc`
- `opcode`
- `stack_delta`
- `local_delta`
- `memory_delta`
- `control_delta`
- `result_flag`

### 6.3 示例风格

例如：

```text
pc=0 op=i32.const push=3
pc=1 op=i32.const push=5
pc=2 op=i32.add pop=2 push=8
pc=3 op=return out=8 halt
```

这只是示意，最终可以用更机器友好的 token 格式，但语义结构应保持一致。

### 6.4 为什么 trace 必须规范化

如果同一执行步骤允许很多表达方式：

- 监督信号会发散
- 模型更容易学风格而不是学语义

所以必须使用 canonical trace。

## 7. 状态表示

模型要学的不是自然语言解释，而是状态推进。

### 7.1 Program Counter

至少需要明确当前执行位置。

### 7.2 Stack Delta

Wasm 是栈机，因此必须清楚编码：

- push 了什么
- pop 了什么
- 栈深变化

### 7.3 Local Delta

至少支持：

- 读哪个 local
- 写哪个 local
- 写入值是什么

### 7.4 Memory Delta

至少支持：

- 访问地址
- 访问宽度
- 读出值或写入值

### 7.5 Control Delta

至少支持：

- branch 是否 taken
- return 是否发生
- halt / trap 是否发生

## 8. 数据生成

要想逼近“通用 Wasm 语义内化”，关键不是收集现成程序，而是系统性生成程序空间。

### 8.1 Program Generator

需要一个程序生成器，而不只是程序收集器。

它应能控制：

- opcode 组合
- CFG 结构
- stack effect
- local dependency
- memory access pattern
- call graph
- recursion depth
- trap case

### 8.2 三类数据来源

#### A. 手工小程序

用于基础语义预热：

- 栈运算
- locals
- 简单 branch
- 简单 memory

#### B. 自动生成程序

用于覆盖程序空间：

- 随机 basic blocks
- 随机 CFG
- 随机 stack pattern
- 随机 memory pattern

#### C. 编译所得程序

用于提高真实性：

- 小型 C / Rust 程序编译为 Wasm
- 排序
- 搜索
- 图算法子模块
- Sudoku solver 简化版本

## 9. 参考解释器与 trace 生成器

训练必须建立在一个标准 teacher 上。

### 9.1 参考解释器

职责：

- 解释执行 Wasm 子集
- 输出标准语义结果
- 捕获 trap

### 9.2 Trace Generator

职责：

- 从参考解释器生成 canonical trace
- 输出训练样本
- 保证 trace 格式稳定

### 9.3 角色定位

这两个组件是训练时的老师，不一定等同于未来生产环境中的 Wasm runtime。

## 10. 训练范式

### 10.1 SFT

最基础步骤：

- 输入程序和输入状态
- 输出完整 trace

这是第一阶段必须完成的基础。

### 10.2 Stepwise Prediction

更接近解释器本质的训练方式是：

- 输入程序、输入状态、历史 trace
- 预测下一步 trace

这会逼模型真正学会状态推进。

### 10.3 Invariant Supervision

仅有 trace prediction 还不够。  
为了逼模型学到解释器不变量，建议额外监督：

- 栈高度是否合法
- branch 是否合法
- 当前状态是否 trap
- memory access 是否越界

### 10.4 Verifier-Guided Training

模型生成 trace 后，用参考解释器逐步比对：

- 哪一步错了
- 错误类型是什么
- 是否最终状态一致

然后可进一步做：

- rejection
- correction tuning
- preference tuning

## 11. Curriculum 设计

这个任务不适合一次性用复杂程序训练。

### 11.1 Phase A：Opcode 语义预热

目标：

- 学会单步和短程栈机语义

### 11.2 Phase B：Trace Machine 学习

目标：

- 学会几十步到几百步 trace
- 学会 locals / memory / branch

### 11.3 Phase C：长程稳定性

目标：

- 学会更长 trace
- 控制误差累积

### 11.4 Phase D：系统集成

目标：

- 作为 `Parametric Execution` 组件接入 Kairo

## 12. 泛化评估

“看起来能跑”不等于“通用内化”。

### 12.1 必须区分的测试集

- seen programs
- seen templates but unseen constants
- unseen control-flow shapes
- unseen compiled programs

### 12.2 关键指标

- next-step accuracy
- full-trace exact match
- final-state correctness
- trap prediction accuracy
- long-horizon stability

### 12.3 为什么不能只看 final answer

因为模型可能：

- 中间 trace 错了
- 最后偶然答对

这不等于解释器语义真的内化了。

## 13. 模型规模与部署策略

### 13.1 先用小模型

不建议一开始拿大模型做。  
先用小 transformer 验证：

- trace 设计
- 数据生成
- 语义学习
- 长程稳定性

### 13.2 Executor Model 与主模型分离

更务实的中期路线是：

- 主模型负责通用认知与 agent 行为
- executor model 负责 Wasm trace 执行

### 13.3 长期方向

长期可以再探索：

- executor 作为主模型 fast path
- 更强的一体化参数内执行

## 14. CPU / GPU 上如何 load 权重

这个问题在 Kairo 中不应只用推理框架语言理解，而应使用系统对象语言理解。

### 14.1 CPU 部署

适合：

- 训练早期验证
- 小 executor model
- trace 调试
- verifier 联调

### 14.2 GPU 部署

适合：

- 更长 trace
- 更大 executor model
- 作为 `Parametric Execution` 快路径

### 14.3 Kairo 中的系统表示

建议通过以下对象理解：

- `WeightStore`
- `InferenceSession`
- `ExecutionPlan`

也就是说：

- 权重不只是文件加载
- 而是从 `WeightStore` 建立一次解释执行会话
- 再按 `ExecutionPlan` 放到 CPU / GPU / hybrid realization 上运行

## 15. 与 Kairo 的系统集成

### 15.1 与 Model Runtime Substrate 的关系

Wasm executor model 直接依赖：

- `WeightStore`
- `InferenceSession`
- `TensorBuffer`
- `KvCache`
- `ExecutionPlan`

### 15.2 与 Dual Execution 的关系

它属于：

- `Parametric Execution`

而不是：

- `Sandboxed Execution`

### 15.3 与 WasmDomain 的关系

二者不是替代关系，而是协同关系：

- 参数内执行负责低延迟内执行
- WasmDomain 负责受控外执行

### 15.4 与 Agent Environment 的关系

环境层需要向模型统一暴露：

- `InternalExecutionTrace`
- `WasmTrace`
- action / observation surface

## 16. 推荐实验路线

### 16.1 MVP-1：最小 Wasm 子集执行器

目标：

- 证明模型能学会基础语义

### 16.2 MVP-2：verifier 闭环

目标：

- 证明它不是胡猜

### 16.3 MVP-3：系统对象化

目标：

- 用 `WeightStore + InferenceSession + ExecutionPlan` 方式组织它

### 16.4 MVP-4：接双层执行

目标：

- 让 agent 可以在参数内执行和 WasmDomain 之间统一切换

## 17. 当前阶段建议

Kairo 当前最需要先统一的不是“大模型怎么直接变解释器”，而是：

1. 训练目标是通用语义，不是样例记忆
2. trace 是核心产物，不是附属日志
3. verifier 是必要组件，不是可选优化
4. CPU / GPU load 权重要纳入系统对象模型
5. 参数内执行和 WasmDomain 必须共存

## 18. 结论

Kairo 的 Wasm 执行器训练路线，不是为了让模型“会几个 Wasm demo”，而是为了让模型真正内化一套可泛化的 Wasm 执行语义。

如果这条路线成立，模型面对未见过的新程序时，不再只是“猜答案”，而是能够：

- 读取程序
- 推进状态
- 生成 trace
- 在系统中作为 `Parametric Execution` 的一部分运行

而这正是 `WASM-as-Weights` 在 Kairo 中真正成立的前提。
