 # v0.3 版本规划（Agent Runtime 集成）
 
 ## 目标
 - Agent 循环升级为 Recall-Plan-Act-Memorize
 - 工具层支持 handle 透传与敏感数据隔离
 
 ## 交付范围
 - Agent Runtime 接入 memory 与 vault
 - 工具调用链的 correlationId 统一
 - 事件链路的 intent 边界定义
 
 ## 验收标准
 - Agent 在响应前调用 memory.recall
 - handle 在工具调用中可传递但不可解构
 - intent 开始与结束事件可回放

## 纵向切片（E2E）
- 单个任务从 recall 到 act 再到 memorize 完整闭环
- 事件链路可追溯到具体意图与工具调用

## 关键场景
- 多轮任务中断后可基于事件恢复进度判断
- 工具链路的 trace 可定位到具体意图
- 安全句柄在工具调用中可用且不泄露

## 非目标
- 复杂规划器或任务状态机
- UI 侧可视化流程
- 设备层权限与资源调度
 
 ## Todo
- [x] 升级 Agent 主循环为 Recall-Plan-Act-Memorize
- [x] 统一 tool.invoke/tool.result 的链路标识
- [x] 定义 intent started/ended 事件并贯通
- [x] 建立工具层对 handle 的透传规则
