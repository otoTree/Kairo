# Wayland Integration Strategy (v0.8+) | Wayland 集成策略

This document outlines how the Kairo AgentOS integrates with the Linux Wayland display server protocol.
本文档概述了 Kairo AgentOS 如何集成 Linux Wayland 显示服务器协议。

## Current Architecture (v0.8 - Phase 1) | 当前架构 (v0.8 - 第一阶段)

In v0.8, we implement the **Kairo Display Protocol (KDP)** using a "Virtual Compositor" approach.
在 v0.8 中，我们使用“虚拟合成器”方法实现了 **Kairo 显示协议 (KDP)**。

- **Kernel**: The `CompositorPlugin` acts as the UI State Manager.
  **内核**: `CompositorPlugin` 充当 UI 状态管理器。
- **Protocol**: Agents emit `kairo.agent.render.commit` events containing a JSON UI Tree.
  **协议**: Agent 发出包含 JSON UI 树的 `kairo.agent.render.commit` 事件。
- **Display Server**: The Web Frontend (`apps/web`) acts as the "Compositor", subscribing to these events and rendering them to the DOM.
  **显示服务器**: Web 前端 (`apps/web`) 充当“合成器”，订阅这些事件并将它们渲染到 DOM。
- **Input**: User interactions in the Web Frontend are sent back as `kairo.ui.signal` events.
  **输入**: Web 前端的用户交互作为 `kairo.ui.signal` 事件发回。

This allows us to validate the Agent-to-UI contract without needing a full native stack immediately.
这使我们能够立即验证 Agent 到 UI 的契约，而无需完整的原生栈。

## Future Architecture (Phase 2+ - Native Wayland) | 未来架构 (第二阶段+ - 原生 Wayland)

To support true "Linux Native Desktop Rendering", we will introduce **Kairo Shell**, a Wayland Compositor.
为了支持真正的“Linux 原生桌面渲染”，我们将引入 **Kairo Shell**，一个 Wayland 合成器。

### 1. Kairo Shell (Compositor) | Kairo Shell (合成器)
- **Technology**: Built using **Zig** and [wlroots](https://gitlab.freedesktop.org/wlroots/wlroots).
  **技术**: 使用 **Zig** 和 [wlroots](https://gitlab.freedesktop.org/wlroots/wlroots) 构建。
- **Role**: It replaces the standard Desktop Environment (GNOME/KDE).
  **角色**: 它取代了标准的桌面环境 (GNOME/KDE)。
- **Integration**:
  **集成**:
    - The Shell connects to the Kairo Kernel via a local WebSocket or Unix Domain Socket.
      Shell 通过本地 WebSocket 或 Unix 域套接字连接到 Kairo 内核。
    - It subscribes to `kairo.agent.render.commit` events.
      它订阅 `kairo.agent.render.commit` 事件。
    - It renders these trees using native GPU APIs (OpenGL/Vulkan) or a toolkit like GTK/Qt/Slint.
      它使用原生 GPU API (OpenGL/Vulkan) 或 GTK/Qt/Slint 等工具包渲染这些树。
    - It forwards hardware input (keyboard/mouse) as `kairo.ui.signal`.
      它将硬件输入（键盘/鼠标）作为 `kairo.ui.signal` 转发。

### 2. Hybrid Mode | 混合模式
- The Web Frontend can continue to exist as a "Remote Desktop" viewer or a "Debug Console".
  Web 前端可以继续作为“远程桌面”查看器或“调试控制台”存在。
- The Protocol is agnostic to the renderer. The same JSON tree can be rendered by React (DOM) or Kairo Shell (Native Surface).
  协议与渲染器无关。同一个 JSON 树可以由 React (DOM) 或 Kairo Shell (原生 Surface) 渲染。

### 3. Implementation Plan | 实施计划
1.  **Protocol Stability**: Ensure `RenderNode` covers all necessary UI primitives (Text, Button, Input, Layouts).
    **协议稳定性**: 确保 `RenderNode` 覆盖所有必要的 UI 原语（文本、按钮、输入、布局）。
2.  **Native Bridge**: Create a `kairo-native-bridge` (Rust/C++) that:
    **原生桥接**: 创建一个 `kairo-native-bridge` (Rust/C++)，用于：
    - Connects to Kairo Kernel.
      连接到 Kairo 内核。
    - Creates a Wayland Surface.
      创建 Wayland Surface。
    - Draws the UI tree.
      绘制 UI 树。
3.  **Shell Integration**: Merge the Bridge into the Compositor process.
    **Shell 集成**: 将 Bridge 合并到 Compositor 进程中。

## How to Test Wayland Logic (Simulation) | 如何测试 Wayland 逻辑 (模拟)
You can currently simulate the Wayland flow using the Web Frontend. The `Compositor` component in `apps/web` mimics the behavior of the future native shell.
您目前可以使用 Web 前端模拟 Wayland 流程。`apps/web` 中的 `Compositor` 组件模仿了未来原生 Shell 的行为。
