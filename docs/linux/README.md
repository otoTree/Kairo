# Kairo Linux 文档

本目录包含 Kairo 自定义 Linux 发行版（Kairo AgentOS）的相关文档。

## 目录索引

*   **[Kairo Linux 定制计划](./plan.md)** (`plan.md`)
    *   概述了发行版选择、架构设计和路线图。
*   **[Kairo Linux 开发指南](./dev_setup.md)** (`dev_setup.md`)
    *   详细说明了如何在 macOS 上搭建开发环境（Zig, QEMU, Docker）。
*   **[Kairo 内核实现指南](./kernel_implementation_guide.md)** (`kernel_implementation_guide.md`)
    *   内核架构总览。
*   **[Kairo Init (Zig) 功能规范](./zig_init_spec.md)** (`zig_init_spec.md`)
    *   详细定义了 PID 1 (Zig) 的功能与职责。
*   **[Kairo Shell (Zig) 功能规范](./kairo_shell_spec.md)** (`kairo_shell_spec.md`)
    *   详细定义了 Kairo 原生合成器 (Wayland Compositor) 的功能与职责。
*   **[Kairo Window Manager 功能规范](./kairo_wm_spec.md)** (`kairo_wm_spec.md`)
    *   详细定义了基于 river-window-management-v1 的窗口布局管理器。
*   **[Shell & Kernel 交互规范](./shell_kernel_interaction_spec.md)** (`shell_kernel_interaction_spec.md`)
    *   定义了 KDP (Display) 和 KCP (Control) 双通道通信协议。
*   **[Kairo Kernel (TS) 功能规范](./ts_kernel_spec.md)** (`ts_kernel_spec.md`)
    *   详细定义了 Kernel (TypeScript) 的功能与职责。

## 相关链接

*   OS 源码: `../../os/`
*   Agent Runtime 源码: `../../src/`
