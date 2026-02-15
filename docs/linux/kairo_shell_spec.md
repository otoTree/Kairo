# Kairo Shell (Zig Compositor) 功能规范

> **Status**: Draft
> **Language**: Zig
> **Base**: [River](https://github.com/riverwm/river) (Zig Wayland Compositor)
> **Backend**: wlroots

## 1. 概述 (Overview)

**Kairo Shell** 是 Kairo AgentOS 的原生图形界面服务器 (Display Server)。
为了避免重复造轮子并确保与现有 Linux 应用生态的完美兼容，我们选择基于 **River** (一个成熟的 Zig Wayland Compositor) 进行定制开发。

它作为一个标准的 Wayland 合成器运行，能够同时管理：
1.  **Agent Native UI**: 通过 Kairo Display Protocol (KDP) 渲染的 Agent 界面。
2.  **Legacy Linux Apps**: 标准的 Wayland 客户端 (如 Firefox, VS Code) 以及 X11 应用 (通过 XWayland)。

**源码位置**: `/os/src/shell/` (基于 River fork 或模块引用)

## 2. 技术栈 (Technology Stack)

*   **编程语言**: Zig (与 River 上游保持一致)
*   **核心引擎**: [River](https://github.com/riverwm/river) (动态平铺窗口管理器)
*   **底层库**: [wlroots](https://gitlab.freedesktop.org/wlroots/wlroots) (处理 DRM/KMS, Input, Rendering)
*   **兼容层**: XWayland (用于支持旧版 X11 应用)
*   **协议**:
    *   `wayland-server` (标准客户端通信)
    *   `river-layout-v3` (自定义布局协议)
    *   `kairo-display-v1` (Agent UI 渲染协议)

## 3. 核心架构 (Architecture)

Kairo Shell 在 River 的基础上扩展了 Agent 交互层：

### 3.1 River Core (Upstream)
直接复用 River 的核心功能：
*   **Window Management**: 强大的动态平铺 (Dynamic Tiling) 引擎。自动将 Agent 悬浮窗与应用窗口并排布局。
*   **Hardware Abstraction**: 通过 wlroots 处理显卡和输入设备。
*   **Tags & Outputs**: 多显示器支持和工作区管理。
*   **XWayland Support**: 零配置支持运行 X11 应用。

### 3.2 Kairo Extension (Customization)
我们在 River 中注入 Kairo 特有的逻辑（作为 River 的内置模块或特权客户端）：

#### A. KDP Server (Agent UI 渲染)
*   实现一个自定义的 Wayland 协议扩展 `kairo-display-v1`。
*   Agent Runtime 通过该协议提交 UI 描述树 (Render Tree)。
*   Shell 直接在 GPU 上绘制这些 UI 元素（作为 Overlay 或独立 Surface），无需启动浏览器。

#### B. Agent Layout Policy (布局策略)
*   **AI 优先**: Agent 的窗口 (如对话框、工具面板) 具有特殊的布局权重。
*   **Smart Tiling**: 当 Agent 打开一个应用（如 "打开 Firefox"）时，Shell 自动将屏幕分割，左边是 Agent 指令，右边是浏览器窗口。

#### C. Input Injection
*   Agent 可以通过 `input-method` 协议模拟键盘/鼠标输入，从而控制其他 Linux 应用（实现 "Computer Use" 能力）。

## 4. 交互模型 (Interaction Model)

### 4.1 "Agent + App" 协同模式
用户不再面对一个静态的桌面壁纸，而是一个 **Agent 驱动的工作台**。

*   **默认视图**: 屏幕中央是 Agent 的全知搜索框 (Omni-box)。
*   **任务视图**: 当 Agent 执行任务时（如“帮我写代码”），它会自动打开 VS Code 和 Terminal，并自动平铺到屏幕两侧。
*   **沉浸模式**: 用户全屏运行游戏或视频时，Agent 自动最小化为角落的徽章。

### 4.2 兼容性 (Compatibility)
得益于 River 和 wlroots，以下应用均可直接运行：
*   **Web Browsers**: Firefox (Wayland), Chromium.
*   **Development**: VS Code (Electron Wayland), JetBrains (新版支持 Wayland).
*   **Terminals**: Alacritty, Kitty, Foot.
*   **Legacy**: 任何 X11 应用 (Steam 游戏, 旧版工具)。

## 5. 开发路线图 (Roadmap)

### Phase 1: River 集成 (Hello River)
*   [ ] 在 `os/` 中引入 River 源码作为依赖。
*   [ ] 编写 `build.zig` 能够编译出原生的 `river` 二进制。
*   [ ] 配置默认的 `init` 脚本 (rivertile)，确保启动后能看到鼠标和背景。
*   [ ] 验证运行 `weston-terminal` 和 `firefox`。

### Phase 2: Kairo 协议扩展
*   [ ] 定义 `kairo-display-v1.xml` Wayland 协议扩展。
*   [ ] 在 River 中实现该协议的服务端逻辑 (Server-side implementation)。
*   [ ] 修改 Agent Runtime，使其能作为 Wayland 客户端连接并发送 UI 树。

### Phase 3: 深度融合
*   [ ] 实现 "Smart Tiling"：Agent 自动管理窗口布局。
*   [ ] 实现 Agent 对应用的输入控制 (Computer Use API)。

## 6. 构建配置

在 `os/build.zig` 中集成 River：

```zig
// 示例：集成 River 构建
const river = b.dependency("river", .{
    .target = target,
    .optimize = optimize,
});
b.installArtifact(river.artifact("river"));
```
