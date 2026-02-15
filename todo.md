# Kairo AgentOS MVP 实施计划

基于 `docs/architecture/agentos-mvp.md` 和 `docs/architecture/agentos-core-gaps.md`。

## 第一阶段：内核基座 (Ring 0)
重点：进程 IO、IPC 推送和事件序列化。

- [ ] **IPC 增强**
    - [ ] 在 `ipc-server.ts` 中实现服务端推送 (`STREAM_CHUNK`) 机制。
    - [ ] 更新 `ipc-client.ts` 以处理传入的推送事件/流。
    - [ ] 实现 `kernel.introspect` (P1) 用于能力协商（v0.1 可选，但建议有）。
- [ ] **进程管理器升级 (Process Manager Upgrade)**
    - [ ] 通过 IPC 暴露 `stdin.write`。
    - [ ] 实现 `stdout/stderr` 订阅（分片/行模式）并支持背压 (backpressure)。
    - [ ] 添加 `process.wait` 和 `process.status` IPC 方法。
    - [ ] 确保通过 EventBus 广播进程退出/状态事件。
- [ ] **事件总线与序列化 (Event Bus & Sequencing)**
    - [ ] 跨 IPC 和 EventBus 标准化 `correlationId` 和 `causationId` 的透传。
    - [ ] 定义并实现 `kairo.intent.started` / `kairo.intent.ended` 事件。
    - [ ] 实现 `InMemoryGlobalBus` 持久化或简单的基于文件的存储以支持恢复（P2，但为基础）。

## 第二阶段：核心服务 (Ring 1)
重点：记忆、安全和设备管理。

- [ ] **MemCube (海马体)**
    - [ ] 初始化 `MemCube` 服务结构（独立进程或隔离模块）。
    - [ ] 实现 `memory.add` 和 `memory.recall` IPC 方法。
    - [ ] 集成向量存储（例如：本地化 HNSW 或简单嵌入缓存）和键值存储 (LMDB)。
- [ ] **Vault (保险箱)**
    - [ ] 实现用于管理机密的 `Vault` 服务。
    - [ ] 实现安全句柄生成 (`sh_...`) 和映射。
    - [ ] 实现 `vault.resolve` 供授权技能检索机密。
- [ ] **安全与原本性证明 (Security & Attestation)**
    - [ ] 在 `process.spawn` 期间实现运行时令牌 (Runtime Token) 注入。
    - [ ] 在内核中实现 PID/哈希校验以进行特权 IPC 调用。

## 第三阶段：Agent 集成 (Ring 3)
重点：Agent 生命周期和端到端验证。

- [ ] **Agent Runtime 升级**
    - [ ] 将 Agent 循环更新为 "Recall-Plan-Act-Memorize"（回溯-规划-行动-记忆）。
    - [ ] 将 `memory` 工具集成到 Agent 的默认工具集中。
    - [ ] 教导 Agent 关于安全句柄的概念（系统提示词更新）。
- [ ] **工具链适配**
    - [ ] 更新标准工具（文件系统、终端）以在适当位置接受 Handle。
    - [ ] 确保 `mcp` 集成支持新的 IPC/Event 模式。
- [ ] **验证**
    - [ ] E2E 测试：Agent 启动一个长时间运行的进程（例如 ping），读取输出并将其杀死。
    - [ ] E2E 测试：Agent 在重启后记住用户偏好。
    - [ ] E2E 测试：使用 Handle 盲执行敏感任务。

## 并行任务：原生渲染 (Agent Native Rendering)
重点：Qt-Wayland 范式、KDP 协议、无 Webview GUI。

- [ ] **协议定义 (Kairo Display Protocol)**
    - [ ] 定义基础组件 (`Text`, `Button`, `Input`, `Markdown`) 的 JSON Schema (`RenderNode`)。
    - [ ] 定义 `kairo.agent.render.commit` (UI 更新) 和 `kairo.ui.signal` (交互信号) 事件结构。
- [ ] **Linux 发行版定制 (Kairo Distro)**
    - [ ] 选择基础发行版 (Alpine/Arch/Debian Minimal)。
    - [x] 初始化 OS 开发环境 (`os/` 目录与 Zig 构建脚本)。
    - [ ] 实现 Kairo Init 进程 (Zig, PID 1)。
    - [ ] 构建自定义 ISO/RootFS (Docker + Alpine)。
    - [ ] 在 macOS 上通过 QEMU 验证启动流程。
- [ ] **前端合成器 (Kairo Compositor)**
    - [ ] 基于 Rust Smithay 或 wlroots 构建 Wayland Compositor。
    - [ ] 实现 DRM/KMS 后端，支持直接硬件渲染。
    - [ ] 集成 `libinput` 处理鼠标/键盘/触摸事件。
- [ ] **Agent GUI 工具包 (Toolkit)**
    - [ ] 在 Agent Runtime 中实现 `ui.render` 原语。
    - [ ] 实现信号/槽 (Signal/Slot) 绑定机制，使 Agent 能响应 UI 事件。

## 待办/未来 (v0.2+)
- [ ] **设备管理器**：`device.claim`、`device.release` 和流式支持。
- [ ] **制品生命周期**：技能分发、签名验证和升级。
- [ ] **高级沙箱**：基于清单权限的网络和文件系统强制执行。
