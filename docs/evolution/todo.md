# Kairo AgentOS 功能演进 — 实施任务清单

> 日期：2026-02-20
> 依据：[PRD](./prd.md) | [Spec](./spec.md)

---

## 阶段一：补齐 MVP v0.1 核心原语 ✅

### 1.1 Process IO 全双工通信 ✅

- [x] 扩展 `ProcessManager`，为每个进程维护 stdin/stdout/stderr 管道引用
- [x] 在 `ipc-server.ts` 注册 `process.stdin.write` 方法
- [x] 在 `ipc-server.ts` 注册 `process.stdout.subscribe` / `unsubscribe` 方法
- [x] 在 `ipc-server.ts` 注册 `process.wait` 和 `process.status` 方法
- [x] 新建 `stream-subscription.ts`，实现 Ring Buffer + 订阅管理
- [x] 添加 backpressure 机制（buffer 满时丢弃旧数据 + overflow 警告）
- [x] 为 Agent Runtime 注册 `kairo_process_write` / `kairo_process_status` / `kairo_process_wait` 系统工具
- [ ] 编写集成测试：Agent 通过 IPC 与 Python REPL 交互

### 1.2 IPC 服务端推送 ✅

- [x] 在 `protocol.ts` 中定义 EVENT (0x03) 和 STREAM_CHUNK (0x04) 帧类型
- [x] 新建 `subscription-manager.ts`，管理 topic → 连接的映射
- [x] 在 `ipc-server.ts` 实现 `subscribe` / `unsubscribe` 方法
- [x] 实现 EVENT 帧推送逻辑（EventBus → 匹配订阅 → 发送帧）
- [x] 实现 STREAM_CHUNK 帧推送逻辑（stdout 数据 → 订阅者）
- [x] 更新 Zig IPC 客户端 (`os/src/wm/ipc.zig`) 支持新帧类型
- [ ] 编写集成测试：外部进程通过 IPC 订阅事件

### 1.3 事件序列语义贯通 ✅

- [x] 在 `in-memory-bus.ts` 的 `publish` 中自动填充 `correlationId`
- [x] 定义 `kairo.cancel` 事件类型
- [x] 在 Agent Runtime 中处理 `kairo.cancel`：终止对应进程 + 发布 cancelled 事件
- [x] 在工具调用链路中贯通 `actionId` → `tool.invoke` → `tool.result`
- [ ] 编写单元测试：验证 correlationId 传播

### 1.4 权限闭环串联 ✅

- [x] 将 `equipSkill` 中构建的 `sandboxConfig` 传递给 `BinaryRunner.run()`
- [x] 在 `ipc-server.ts` 添加连接身份关联（pid, skillId, runtimeToken）
- [x] 实现 `process.*` 方法的所有权检查
- [x] 在 `ProcessManager` 中追踪进程创建者
- [ ] 编写集成测试：Skill 进程无法操作其他 Skill 的进程

---

## 阶段二：增强 Agent 智能

### 2.1 MemCube 增强

- [ ] 添加 `namespace` 参数到 `add()` 和 `recall()`，实现多 Agent 记忆隔离
- [ ] 实现 `share(fromNamespace, toNamespace, memoryId)` 方法
- [ ] 优化 GC：使用 LMDB 二级索引按 layer 过滤，避免全表扫描
- [ ] 添加 `export(format)` 和 `import(data)` 方法
- [ ] 编写性能测试：10000 条记忆的 GC 耗时 < 1s

### 2.2 盲盒编排落地

- [ ] 完善 `Vault.resolveWithToken` 链路，确保所有工具调用都通过 token
- [ ] 实现 Kernel Fingerprint：在 `BinaryRunner` 中计算二进制 hash 并注入环境变量
- [ ] 在 Vault 中添加审计日志（访问者、时间、句柄 ID）
- [ ] 实现凭证轮换通知：Vault 变更时发布 `kairo.vault.rotated` 事件
- [ ] 编写安全测试：无 token 的进程无法解析 vault handle

### 2.3 Agent 协作模型

- [ ] 在 `agent.plugin.ts` 中实现 `delegateTask(parentId, childId, task)` 方法
- [ ] 在 Agent Runtime 中添加 `kairo.agent.{id}.task` 事件订阅
- [ ] 实现能力声明：Agent 启动时发布 `kairo.agent.capability` 事件
- [ ] 在路由层利用能力声明进行智能分发
- [ ] 编写集成测试：两个 Agent 协作完成文件处理任务

---

## 阶段三：完善系统层

### 3.1 Init 进程完整实现

- [ ] 实现文件系统挂载（/proc, /sys, /dev, /tmp）
- [ ] 实现服务依赖图解析和启动编排
- [ ] 添加服务健康检查（定期 ping）
- [ ] 实现服务自动重启（最多 3 次，间隔递增）
- [ ] 编写集成测试：在 Lima VM 中验证 Init 进程

### 3.2 设备管理生命周期

- [ ] 在 `DeviceRegistry` 中实现 `claim` / `release` 的并发控制（互斥锁）
- [ ] 实现热插拔事件 → Agent 通知链路
- [ ] 为 Agent 注册 `kairo_device_claim` / `kairo_device_release` 系统工具
- [ ] 实现驱动抽象层统一接口（Serial/GPIO/Camera）
- [ ] 编写集成测试：模拟设备热插拔

### 3.3 UI 合成器完善

- [ ] 在 `KairoDisplay.zig` 中实现 `user_action` 事件发送
- [ ] 在 `compositor.plugin.ts` 中实现信号路由（KDP → EventBus）
- [ ] 实现 UI diff 算法（对比新旧 UI 树，仅更新变化节点）
- [ ] 扩展 UI 组件集：List、Image、Chart、Modal
- [ ] 编写端到端测试：用户点击按钮 → Agent 响应

### 3.4 D-Bus 集成

- [ ] 在 Zig Init 进程中启动 D-Bus daemon
- [ ] 实现 D-Bus → EventBus 桥接
- [ ] 通过 D-Bus 控制 systemd 服务（start/stop/restart）
- [ ] 集成 NetworkManager（网络配置查询和修改）

---

## 阶段四：工程成熟度

### 4.1 测试体系

- [ ] 为每个 IPC 方法编写集成测试
- [ ] 为 Agent Runtime tick 循环编写单元测试（mock AI 响应）
- [ ] 为 MemCube 编写并发测试
- [ ] 为 Web 应用编写组件测试（Vitest + Testing Library）
- [ ] 配置测试覆盖率报告，目标 ≥ 70%

### 4.2 CI/CD 流水线

- [ ] 创建 `.github/workflows/ci.yml`：lint → test → build
- [ ] 配置 Zig 交叉编译（x86_64-linux + aarch64-linux）
- [ ] 配置 Docker 镜像自动构建和推送
- [ ] 配置 Lima VM 集成测试（可选，nightly）

### 4.3 可观测性

- [ ] 创建 `Logger` wrapper，替换所有 `console.log` 调用
- [ ] 定义结构化错误码枚举（`KairoError.PROCESS_NOT_FOUND` 等）
- [ ] 在所有层贯通 `traceId` / `spanId`
- [ ] 添加性能指标采集：Agent tick 延迟、IPC 吞吐量、MemCube 查询耗时

### 4.4 文档治理

- [ ] 删除 3 个 DEPRECATED/OUTDATED 文档
- [ ] 从 IPC 方法注册代码自动生成 API 参考文档
- [ ] 编写《Skill 开发指南》
- [ ] 编写《部署运维手册》
