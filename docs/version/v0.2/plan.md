 # v0.2 版本规划（Core Services 最小闭环）
 
 ## 目标
 - 引入核心服务的最小可用形态
 - 建立安全句柄与最小身份校验路径
 
 ## 交付范围
 - MemCube 最小 add/recall 接口
 - Vault 基础 handle 生成与解析
 - Runtime Token 注入与基础 attestation
 
 ## 验收标准
 - Agent 可通过 memory.recall 获取跨会话信息
 - Skill 只能通过 handle 访问敏感数据
 - 恶意进程无法伪造合法身份调用 Vault

## 纵向切片（E2E）
- 写入记忆后重启并成功回溯
- handle 在工具链路中可传递并被安全兑换

## 关键场景
- 记忆服务在重启后可回溯最近任务信息
- handle 传递跨工具链路且不可被 Agent 解构
- 冒名进程请求被拒绝并记录审计事件

## 非目标
- 记忆衰减、晋升与复杂检索策略
- 多租户身份与远程授权
- 完整设备权限与占用流程
 
 ## Todo
 - 实现 memory.add 与 memory.recall 的 IPC 接口
 - 实现 vault.store 与 vault.resolve 的最小能力
 - 在 spawn 流程注入 runtime token
 - 在 IPC 层增加调用方身份校验
