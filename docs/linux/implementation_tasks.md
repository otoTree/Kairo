# Kairo Linux 实施任务清单 (Implementation Tasks)

本文档整理了从零构建 Kairo Shell 及集成 Kernel 的详细开发步骤。在开始每个阶段前，请务必阅读相应的规范文档。

## 阶段一：环境准备与 River 集成 (Environment & River)

本阶段目标是编译出一个原生的、可运行的 River Compositor。

### 1.1 开发环境搭建
*   **必读文档**: [开发环境搭建指南](./dev_setup.md) (`dev_setup.md`)
*   **任务**:
    *   [ ] 安装 Zig 0.13+ (或 River 要求版本)。
    *   [ ] 安装 Wayland 协议开发包 (`wayland-protocols`, `wayland-scanner`).
    *   [ ] 安装 `wlroots` 依赖 (或确认 Zig 构建脚本能自动拉取)。
    *   [ ] (macOS 用户) 配置 Lima/QEMU Linux 虚拟机，因为 macOS 不支持 DRM/KMS。

### 1.2 River 源码集成
*   **必读文档**: [Kairo Shell 规范](./kairo_shell_spec.md) (`kairo_shell_spec.md`)
*   **任务**:
    *   [ ] 在 `os/` 目录下初始化 Zig 项目结构。
    *   [ ] 在 `os/build.zig` 中添加 `river` 作为依赖 (Fork 或 Upstream)。
    *   [ ] 编译测试：运行 `zig build` 确保能生成 `river` 二进制文件。
    *   [ ] 编写基础启动脚本 `init`，确保 River 启动后不报错退出。

---

## 阶段二：Kairo WM 原型开发 (Window Manager)

本阶段目标是接管窗口布局逻辑，实现基础的“主副窗口”平铺。

### 2.1 WM 基础架构
*   **必读文档**: [Kairo WM 规范](./kairo_wm_spec.md) (`kairo_wm_spec.md`)
*   **任务**:
    *   [ ] 创建 `os/src/wm/` 目录。
    *   [ ] 实现 `river-window-management-v1` 协议的 Client 端连接。
    *   [ ] 编写一个简单的 Zig 程序，连接到运行中的 River 并打印窗口事件。

### 2.2 布局算法实现
*   **任务**:
    *   [ ] 实现 `Master/Stack` 布局逻辑：第一个窗口占左半边，后续窗口平分右半边。
    *   [ ] 替换 River 默认的 `rivertile`，使用 `kairo-wm` 作为布局管理器。
    *   [ ] 验证：打开多个终端窗口，观察布局是否符合预期。

---

## 阶段三：Kernel 通信与混合桌面 (Kernel IPC)

本阶段目标是打通 TS Kernel 与 Zig Shell 的通信通道。

### 3.1 KCP 协议实现 (Control Channel)
*   **必读文档**: [Shell & Kernel 交互规范](./shell_kernel_interaction_spec.md) (`shell_kernel_interaction_spec.md`)
*   **任务**:
    *   [ ] **Kernel 端**: 在 `src/domains/kernel` 中实现 KCP Server (Unix Socket /tmp/kairo-kernel.sock)。
    *   [ ] **Shell 端**: 在 Zig 中实现 KCP Client，启动时尝试连接 Kernel。
    *   [ ] **联调**: Shell 发送 `system.hello`，Kernel 收到并打印日志。

### 3.2 混合合成原型 (Hybrid Composition)
*   **任务**:
    *   [ ] **Agent 占位**: 在 `kairo-wm` 中添加逻辑，当收到 Kernel 的 "Agent Active" 信号时，强制预留屏幕右侧 30% 空间。
    *   [ ] **测试**: 模拟发送信号，观察现有窗口是否自动挤压变形。

---

## 阶段四：KDP 协议与 UI 渲染 (Display Protocol)

本阶段目标是让 Agent 能在屏幕上画出原生的 UI。

### 4.1 协议定义与注入
*   **任务**:
    *   [ ] 编写 `kairo-display-v1.xml` 协议定义文件。
    *   [ ] 修改 River 源码，注册该协议扩展。

### 4.2 渲染器实现
*   **任务**:
    *   [ ] 在 River 渲染循环 (render loop) 中注入 Overlay 绘制逻辑。
    *   [ ] 实现简单的矩形和文本绘制 (使用 Cairo 或 OpenGL)。
    *   [ ] **Kernel 端**: 实现 KDP Client，发送一个 JSON UI 树。
    *   [ ] **联调**: Kernel 发送指令，屏幕上出现一个悬浮的“Hello Kairo” 文本框。

---

## 附录：文档阅读顺序

1.  `plan.md` (总览)
2.  `dev_setup.md` (环境)
3.  `kairo_shell_spec.md` (Shell 架构)
4.  `kairo_wm_spec.md` (布局逻辑)
5.  `shell_kernel_interaction_spec.md` (通信协议)
6.  `ts_kernel_spec.md` (Kernel 适配)
