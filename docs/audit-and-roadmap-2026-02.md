# Kairo AgentOS 项目审计与演进路线

> 审计日期：2026-02-20
> 范围：TypeScript 运行时 / Zig OS 层 / 工程基础设施 / 功能完整度

---

## 一、安全缺陷（P0 — ✅ 已全部修复）

### 1.1 ~~硬编码默认密钥~~ ✅ 已修复

**位置**：`src/index.ts:111`

**修复**：启动时检测未设置 `KAIRO_TOKEN` 则拒绝启动，或自动生成随机密钥。

### 1.2 ~~命令注入~~ ✅ 已修复

**位置**：`src/domains/skills/skills.plugin.ts:260`

**修复**：使用 `Bun.spawn` 数组参数形式，避免 shell 解释。

### 1.3 ~~seccomp 过滤器漏洞~~ ✅ 已修复

**位置**：`src/domains/sandbox/vendor/seccomp-src/seccomp-unix-block.c:12`

**修复**：添加 `socketcall` 到 seccomp 黑名单，补充 32 位 x86 架构支持。

### 1.4 ~~MCP SDK 高危漏洞~~ ✅ 已修复

**位置**：`package.json`

**修复**：已升级 `@modelcontextprotocol/sdk` 到 ≥1.26.0。

### 1.5 ~~CORS 完全开放~~ ✅ 已修复

**位置**：`src/domains/server/server.plugin.ts:29`

**修复**：限制为已知前端域名，从环境变量读取白名单。

### 1.6 ~~路径遍历保护不足~~ ✅ 已修复

**位置**：`src/domains/skills/skills.plugin.ts:247`

**修复**：使用 `path.resolve(scriptPath).startsWith(path.resolve(skill.path))` 规范化路径。

---

## 二、核心缺陷（P1 — ✅ 已全部修复）

### 2.1 ~~Zig Init 进程为空壳~~ ✅ 已修复

**位置**：`os/src/main.zig:3-6`

**修复**：已添加 SIGCHLD 信号处理、SIGTERM/SIGINT 优雅关机、服务启动编排、进程监控与自动重启。

### 2.2 ~~Zig WM 内存泄漏~~ ✅ 已修复

**位置**：`os/src/wm/main.zig:71-88`

**修复**：添加 `errdefer ctx.allocator.destroy(win)` 等错误路径资源释放。

### 2.3 ~~空 catch 块吞没错误~~ ✅ 已修复

**位置**：
- `src/domains/skills/skills.plugin.ts:34,251,303`
- `src/domains/sandbox/sandbox-manager.ts:540,576`
- `src/domains/kernel/system-info.ts:51-66`

**修复**：所有空 catch 块已添加错误日志记录。

### 2.4 ~~Agent Runtime 竞态条件~~ ✅ 已修复

**位置**：`src/domains/agent/runtime.ts:191-234`

**修复**：使用 Promise 锁 / AsyncMutex 替代 `isTicking` 布尔标志。

### 2.5 ~~MemCube 并发 ID 冲突~~ ✅ 已修复

**位置**：`src/domains/memory/memcube.ts:100-165`

**修复**：使用原子操作或在事务内分配 ID。

### 2.6 ~~JSON.parse 缺少错误处理~~ ✅ 已修复

**位置**：
- `src/domains/server/server.plugin.ts:78`（WebSocket 消息）
- `src/domains/device/registry.ts:68`（配置文件）
- `src/domains/database/repositories/checkpoint-repository.ts:29,43`

**修复**：所有 `JSON.parse` 调用已添加 try-catch 错误处理。

### 2.7 ~~KDP 缺少输入验证~~ ✅ 已修复

**位置**：`os/src/shell/river/KairoDisplay.zig:107-109`

**修复**：添加 JSON payload 大小限制和深度限制。

---

## 三、质量问题（P2 — 影响可维护性）

| 问题 | 位置 | 说明 |
|------|------|------|
| 20+ 处 `any` 类型 | plugin.ts, app.ts, ipc-server.ts, runtime.ts 等 | 丧失类型安全 |
| 40+ 处裸 `console.log` | 几乎所有 plugin 文件 | 应统一使用 observability/logger |
| pendingActions 无上限 | runtime.ts:67 | 工具调用失败时 Set 无限增长 |
| eventBuffer 无上限 | runtime.ts:70 | tick 处理前可能累积大量事件 |
| MemCube 多步写无事务 | memcube.ts:143-161 | 中途失败导致数据不一致 |
| IPC MsgPack 伪解析 | os/src/wm/ipc.zig:93-132 | 用字符串搜索代替完整解析 |
| Wayland 监听器泄漏 | os/src/wm/main.zig:35-65 | closed/removed 未清理资源 |
| 硬编码库路径 | os/build.zig:47-48 | `/usr/lib` 应使用 pkg-config |
| 测试覆盖不足 | Zig 仅 1 个测试文件，Web 应用零测试 | — |
| 无 CI/CD | — | 无自动化构建/测试/部署 |

---

## 四、功能完整度分析

### 4.1 已完成且可用

| 模块 | 状态 | 说明 |
|------|------|------|
| 插件系统 | ✅ | 14 个插件按序加载，生命周期完整 |
| Agent Runtime | ✅ | PLAN-ACT-MEMORIZE 循环、工具调用、上下文压缩 |
| 事件总线 | ✅ | InMemoryGlobalBus + wildcard + SQLite 持久化 |
| Kernel IPC | ✅ | Unix Socket + MsgPack，支持 process/device/system 方法 |
| Shell 管理 | ✅ | 持久化终端会话，类 tmux |
| MemCube | ✅ | 三层记忆 + HNSW 向量检索 + 遗忘曲线 |
| 沙箱 | ✅ | macOS sandbox-exec / Linux bubblewrap，网络+文件隔离 |
| Skills | ✅ | V2 Manifest + 二进制/脚本/容器执行 |
| MCP 集成 | ✅ | 服务器注册 + 工具路由 + 调用分发 |
| Vault | ✅ | 句柄机制 + Runtime Token + 令牌撤销 |
| River 集成 | ✅ | Wayland Compositor + KDP Overlay 渲染 |
| Kairo WM | ✅ | Master/Stack 布局 + IPC 状态同步 |

### 4.2 部分实现（有明显缺口）

| 模块 | 缺口 |
|------|------|
| Process IO | `stdin.write`、`process.wait`、`process.status` 未实现；stdout/stderr 订阅未对外暴露 |
| 事件序列语义 | correlationId/causationId 字段存在但未在所有链路强制使用；取消语义未实现 |
| 权限闭环 | manifest permissions 已定义但未在执行路径消费；IPC 方法级鉴权未实现 |
| UI 合成器 | 仅状态管理，信号路由未实现（仅日志），无 UI diff |
| 设备管理 | 监控已实现，但 `device.claim/release`、并发控制、热插拔恢复缺失 |
| 多 Agent 路由 | 语义路由依赖 LLM 判断，准确率不可控 |

### 4.3 文档已设计但未实现

| 功能 | 文档位置 | 说明 |
|------|----------|------|
| Process IO 全双工通信 | docs/architecture/agentos-mvp.md | MVP v0.1 核心目标，当前未完成 |
| IPC EVENT/STREAM_CHUNK 推送 | docs/architecture/kernel-ipc-spec.md | 服务端主动推送未落地 |
| 取消语义 | docs/architecture/agentos-mvp.md | 事件驱动的中断传播 |
| 协作窗口 | docs/architecture/human-ai-collaboration.md | 三层空间模型（AI/人/共享） |
| D-Bus 系统服务控制 | docs/linux/plan.md | 通过 D-Bus 控制 systemd 服务 |

---

## 五、功能演进指导

基于当前实现状态和架构设计，以下是建议的演进方向：

### 阶段一：补齐 MVP v0.1 核心原语

**目标**：让 Agent 能与任意二进制程序全双工通信。

1. **实现 Process IO 原语**
   - `process.stdin.write(pid, data)` — 向子进程写入
   - `process.stdout.subscribe(pid, mode)` — chunk/line 模式订阅
   - `process.wait(pid)` — 等待进程退出
   - `process.status(pid)` — 查询进程状态
   - 添加 backpressure 机制防止 OOM

2. **实现 IPC 服务端推送**
   - `EVENT` 帧类型：结构化事件推送
   - `STREAM_CHUNK` 帧类型：二进制流推送（stdout/stderr）
   - 客户端订阅机制（`subscribe`/`unsubscribe`）

3. **贯通事件序列语义**
   - 所有事件强制携带 `correlationId` / `causationId`
   - 实现取消语义：`cancel` 事件传播到进程终止
   - 工具层贯通 `actionId` → `tool.invoke` → `tool.result`

4. **串联权限闭环**
   - manifest permissions → sandbox enforcement 自动映射
   - IPC 方法级鉴权（caller 只能控制自己创建的进程）
   - deny-by-default 策略强制执行

### 阶段二：增强 Agent 智能

**目标**：让 Agent 具备长期记忆和安全的凭证管理。

1. **MemCube 增强**
   - 添加 `namespace` 支持（多 Agent 记忆隔离）
   - 实现记忆共享机制（Agent 间知识传递）
   - 优化 GC 性能（当前全表扫描，改为索引驱动）
   - 添加记忆导入/导出（JSON/向量格式）

2. **盲盒编排落地**
   - 完善 Vault resolveWithToken 链路
   - 实现 Kernel Fingerprint（Binary Hash 校验）
   - 添加审计日志（谁在什么时候访问了什么凭证）
   - 实现凭证轮换通知

3. **Agent 协作模型**
   - 实现 Agent 间消息传递（通过 EventBus topic 隔离）
   - 实现任务委派（parent Agent → child Agent）
   - 添加 Agent 能力声明（capability advertisement）

### 阶段三：完善系统层

**目标**：让 Kairo 成为可独立运行的操作系统。

1. **Init 进程完整实现**
   - SIGCHLD 处理 + 僵尸进程回收
   - 服务依赖图 + 启动编排
   - 健康检查 + 自动重启
   - 优雅关机序列

2. **设备管理生命周期**
   - `device.claim(deviceId)` / `device.release(deviceId)`
   - 并发访问控制（互斥锁）
   - 热插拔事件 → Agent 通知
   - 驱动抽象层（Serial/GPIO/Camera 统一接口）

3. **UI 合成器完善**
   - 实现 KDP `user_action` 事件（用户交互回传）
   - UI diff 算法（减少重绘）
   - 扩展组件集（List、Image、Chart、Modal）
   - 实现信号路由（UI 事件 → Agent 事件）

4. **D-Bus 集成**
   - 通过 D-Bus 控制 systemd 服务
   - NetworkManager 集成（网络配置）
   - 蓝牙/音频设备管理

### 阶段四：工程成熟度

**目标**：达到生产可用的工程质量。

1. **测试体系**
   - 为每个 IPC 方法编写集成测试
   - Agent Runtime tick 循环的单元测试
   - Zig WM/KDP 的端到端测试
   - Web 应用组件测试
   - 测试覆盖率 ≥ 70%

2. **CI/CD 流水线**
   - GitHub Actions：lint → test → build
   - Zig 交叉编译（x86_64 + aarch64）
   - Docker 镜像自动构建
   - Lima VM 集成测试

3. **可观测性**
   - 统一日志系统（替换所有 console.log）
   - 结构化错误码（替换字符串错误）
   - 分布式追踪（traceId/spanId 贯通所有层）
   - 性能指标采集（Agent tick 延迟、IPC 吞吐量）

4. **文档治理**
   - 清理 3 个 DEPRECATED/OUTDATED 文档
   - 生成 IPC API 参考文档
   - 编写 Skill 开发指南
   - 编写部署运维手册

---

## 六、优先级总览

```
P0 安全修复 ✅ 已全部修复
├── ✅ 移除硬编码密钥
├── ✅ 修复命令注入
├── ✅ 修复 seccomp 漏洞
├── ✅ 升级 MCP SDK
├── ✅ 收紧 CORS
└── ✅ 修复路径遍历

P1 核心缺陷 ✅ 已全部修复
├── ✅ 实现 Init 进程
├── ✅ 修复 Zig 内存泄漏
├── ✅ 消除空 catch 块
├── ✅ 修复竞态条件
├── ✅ 添加 JSON.parse 错误处理
└── ✅ KDP 输入验证

阶段一：MVP v0.1 补齐 ✅ 已完成
├── ✅ Process IO 全双工
├── ✅ IPC 服务端推送
├── ✅ 事件序列语义贯通
└── ✅ 权限闭环串联

阶段二：Agent 智能增强
├── MemCube namespace + 共享
├── 盲盒编排落地
└── Agent 协作模型

阶段三：系统层完善
├── Init 进程完整实现
├── 设备管理生命周期
├── UI 合成器完善
└── D-Bus 集成

阶段四：工程成熟度
├── 测试体系
├── CI/CD 流水线
├── 可观测性
└── 文档治理
```
