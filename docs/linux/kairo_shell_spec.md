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

Kairo Shell 基于 **River** 的架构进行扩展。由于 River 采用了 "Split Window Management" 设计（即将布局逻辑委托给外部进程），Kairo Shell 将由以下几个核心组件构成：

### 3.1 River Core (Forked)

为了支持 Kairo 特有的协议和渲染需求，我们将 Fork River 并进行必要的修改：
*   **Compositor**: 负责 DRM/KMS 输出、输入设备管理、Wayland 协议处理。
*   **KDP Server (Kairo Display Protocol)**: 在 River 内部实现 `kairo-display-v1` 协议服务端。
    *   这是一个自定义 Wayland 扩展，允许 Agent Runtime 提交 UI 树。
    *   River 将直接在 Overlay 层绘制这些 UI 元素（Agent Panel, Omni-box），确保其位于所有应用窗口之上。
*   **Input Injection**: 利用 wlroots 提供的能力，实现 Agent 对键盘/鼠标的模拟控制。

### 3.2 Kairo WM (Window Manager)

这是一个独立的 Zig 程序（或作为 River 的 init 进程启动），实现 `river-window-management-v1` 协议。它接管窗口布局逻辑：
*   **Smart Tiling**: 实现“主副窗口”布局。Agent Panel 占据固定区域，应用窗口自动平铺在剩余空间。
*   **Tag Management**: 自动将不同任务（Coding, Browsing）分配到不同的 Tag（工作区）。

### 3.3 数据流向

1.  **Agent UI 渲染**: Kernel -> KDP Protocol -> River Core (Overlay Layer)。
2.  **窗口布局控制**: Kernel -> IPC -> Kairo WM -> River Management Protocol -> River Core。

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

### Phase 1: River 基础集成
*   [ ] Fork `riverwm/river` 到 `kairo-os/river`。
*   [ ] 在 `os/` 目录中建立构建系统，确保能编译出原生的 `river` 二进制。
*   [ ] 编写基础的 `init` 脚本，启动一个简单的布局管理器（如 rivertile），验证桌面可运行。

### Phase 2: Kairo WM 开发
*   [ ] 开发 `kairo-wm` (Zig)，实现 `river-window-management-v1` 协议。
*   [ ] 实现基础的 Tiling 算法。
*   [ ] 实现 IPC 接口，允许 Kernel 控制布局（如“将当前窗口移到右侧”）。

### Phase 3: KDP 协议实现
*   [ ] 定义 `kairo-display-v1.xml`。
*   [ ] 修改 River 源码，注册并实现该协议。
*   [ ] 实现 Overlay 渲染器，能够解析 JSON UI 树并绘制简单图形。

### Phase 4: 深度融合
*   [ ] 实现 "Smart Tiling"：当 Agent Panel 显示时，`kairo-wm` 自动调整布局区域。
*   [ ] 实现 Agent 对应用的输入控制 (Computer Use API)。

## 6. 构建配置

在 `os/build.zig` 中集成 River：

```zig
// 示例：集成 River 构建
const river = b.dependency("river", .{
    .target = target,
    .optimize = optimize,
    .xwayland = true, // 启用 XWayland 支持
});
b.installArtifact(river.artifact("river"));
```
