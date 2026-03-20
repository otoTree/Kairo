# Kairo 路线图

本文档将当前已经统一的架构思想，收敛为一条可执行的阶段路线。  
它的目的不是列一张功能愿望清单，而是回答一个更现实的问题：

在不破坏当前架构方向的前提下，Kairo 应该按什么顺序落地，才能从“最小启动原型”逐步演进成一个真正的 agent-native system platform。

## 1. 路线图原则

### 1.1 先稳语义，再堆功能

如果核心对象、执行边界和平台语言没有稳定，就不应急于铺开更复杂的运行时细节。

### 1.2 先建立骨架，再填实现

Kairo 当前最缺的不是“更多代码”，而是“能承载未来代码的正确骨架”。

### 1.3 先 CPU bring-up，再保持 GPU/hybrid 兼容

早期实现应优先以 CPU realization 为 bring-up 平台，但绝不能因此把抽象重新写死为 CPU 专属。

### 1.4 先 external sandbox，再 parametric execution

双层执行里，`Sandboxed Execution` 比 `Parametric Execution` 更适合作为早期落地路径。

### 1.5 不为传统兼容层预留主线预算

Kairo 当前阶段不为传统 Linux 兼容预留主线资源。

### 1.6 模型负责智能，系统负责环境

Kairo 不应先做一个厚重的外部 agent runtime。  
相反，应先把：

- Model Core
- Agent Environment Layer

这两层的边界明确下来。

## 2. 阶段总览

Kairo 当前建议分为九个阶段推进：

1. Phase 0：文档收敛与架构冻结
2. Phase 1：源码骨架重组
3. Phase 2：核心对象最小落地
4. Phase 3：系统服务边界落地
5. Phase 4：执行域骨架落地
6. Phase 5：模型底座最小闭环
7. Phase 6：WasmDomain 最小闭环
8. Phase 7：Agent Environment 最小闭环
9. Phase 8：Parametric Execution 与 Native/Wasm/Agent 深化

## 3. Phase 0：文档收敛与架构冻结

### 3.1 目标

统一系统总体语言，明确：

- Kairo 是 agent-native platform
- 对象模型优先
- 双层执行成立
- Wasm 有双重角色
- CPU / GPU / hybrid 并存
- 不为传统 Linux 兼容保留主线地位
- 模型是 agent 行为主体，外部层是环境语义层

## 4. Phase 1：源码骨架重组

### 4.1 目标

将当前的最小内核代码，从单文件原型逐步重组到新架构骨架下。

### 4.2 建议目录

```text
kairo-kernel/src/
├── core/
├── object/
├── service/
├── domain/
├── substrate/
│   ├── model/
│   └── parametric/
├── runtime/
│   └── agent_env/
├── realization/
│   ├── cpu/
│   ├── gpu/
│   └── hybrid/
├── arch/
├── boot/
└── main.rs
```

## 5. Phase 2：核心对象最小落地

优先对象：

1. `Handle`
2. `Capability`
3. `ExecutionUnit`
4. `ProtectionDomain`
5. `Channel`
6. `FaultEvent`

## 6. Phase 3：系统服务边界落地

优先服务：

1. Namespace Service
2. File Service
3. Process Service
4. Device Service
5. Network Service

## 7. Phase 4：执行域骨架落地

优先域：

1. `NativeDomain`
2. `WasmDomain`
3. `InferenceDomain`
4. `AgentDomain`

## 8. Phase 5：模型底座最小闭环

优先对象：

1. `WeightStore`
2. `TensorBuffer`
3. `InferenceSession`
4. `ExecutionPlan`

## 9. Phase 6：WasmDomain 最小闭环

最小闭环内容：

- `WasmModule`
- `WasmInstance`
- `WasmCapability`
- `WasmHostBinding`
- `WasmTrace`

## 10. Phase 7：Agent Environment 最小闭环

### 10.1 目标

让环境语义层成为真正可操作的系统层，而不是纯概念。

### 10.2 优先对象

1. `ContextObject`
2. `MemoryStore`
3. `ToolCapability`
4. `ExecutionLease`
5. `ObservationRecord`
6. `ActionSurface`

### 10.3 最小闭环路径

1. 绑定上下文与记忆载体
2. 暴露统一 observation / action surface
3. 发起一次推理请求
4. 模型自行决定进入 `WasmDomain`
5. 执行外部模块
6. 将结果以统一 observation 形式回写

## 11. Phase 8：Parametric Execution 与 Native/Wasm/Agent 深化

### 11.1 Parametric Execution 扩展

逐步探索：

- 模型内部 trace 执行
- 结构化程序解释
- `WASM-as-Weights`
- 推理快路径

### 11.2 Native / Wasm / Agent 深化

逐步增强：

- NativeDomain 的原生对象运行时
- WasmDomain 的更强 host binding 与审计
- Agent 环境层的长期记忆、上下文治理和反馈统一

## 12. 风险控制

### 12.1 回退成传统兼容系统

症状：

- 重新把传统 process/thread/file 当成底层真相
- 开始为兼容旧生态投入主线资源

### 12.2 回退成厚外部 agent runtime

症状：

- planner / reviewer / action loop 被重新外置
- 系统开始替模型思考

### 12.3 回退成推理框架容器

症状：

- 模型对象全部藏在用户态 runtime 私有结构中

## 13. 当前推荐的下一步

基于当前仓库状态，最合理的下一步是进入 Phase 1：

1. 重组源码目录骨架
2. 引入最小对象模块
3. 建立 `ExecutionDomain` 占位
4. 为 WasmDomain、InferenceDomain、AgentDomain 留出代码入口
5. 为 Agent Environment Layer 留出代码入口

## 14. 结论

Kairo 的路线图不是“先做一个 OS，再想办法让它跑 agent”，而是：

1. 先固定系统语义
2. 再建立骨架
3. 再建立核心对象与执行边界
4. 再建立模型底座、Wasm 外执行和环境语义层
5. 最后才逐步扩展参数内执行和多平台 realization
