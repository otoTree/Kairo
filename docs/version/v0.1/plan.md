 # v0.1 版本规划（Kernel Foundation）
 
 ## 目标
 - 形成可用的内核通信与进程 IO 基础
 - 打通事件链路的最小语义
 - 完成最小权限闭环与审计
 
 ## 交付范围
 - IPC 支持 REQUEST/RESPONSE + EVENT/STREAM_CHUNK 推送
 - Process IO 全双工读写与输出订阅
 - correlationId/causationId 贯通
 - 权限声明到沙箱执行的最小闭环
 
 ## 验收标准
 - 交互式 CLI 可被启动、写入、读回输出
 - 进程输出以流式分片推送且具有限速策略
 - 权限不足触发可观测事件并拒绝调用

## 纵向切片（E2E）
- 启动技能进程并进行 stdin 写入与 stdout 订阅
- 输出流与权限拒绝事件可被回放还原

## 关键场景
- 启动 Python REPL 并持续读写标准输入输出
- 长时任务输出被限速且不中断主流程
- 未声明权限的技能被拒绝并产生审计事件

## 非目标
- MemCube/Vault 的功能落地
- 设备占用与流式 IO 能力
- 复杂的任务状态机与重试策略
 
 ## Todo
 - 实现 IPCServer 的 EVENT/STREAM_CHUNK 推送
 - 实现 process.stdin.write 与 stdout/stderr 订阅
 - 完成 process.wait 与 process.status
 - 贯通 correlationId/causationId 透传
 - 权限声明映射为沙箱配置并执行
