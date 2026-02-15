# Kairo Linux 定制计划 (Kairo Linux Customization Plan)

本文档概述了构建 Kairo AgentOS 自定义 Linux 发行版的计划。

> **开发指南**: 关于如何在 macOS 上搭建开发环境并测试构建，请参阅 [Linux 开发指南](./dev_setup.md)。

## 1. 基础发行版选择 (Base Distribution Selection)
*   **选项 A: Alpine Linux** (推荐：极简与安全)
    *   优点：极其轻量，面向安全 (musl libc)，包管理简单 (apk)。
    *   缺点：musl libc 可能与部分专有二进制文件存在兼容性问题。
*   **选项 B: Arch Linux** (推荐：灵活性与文档)
    *   优点：滚动更新，庞大的 AUR，卓越的文档 (Arch Wiki)。
    *   缺点：需要更多的维护和配置。
*   **选项 C: Debian Minimal** (稳定且广泛支持)
    *   优点：稳定，巨大的软件仓库，`apt`。
    *   缺点：软件包较旧。

## 2. 内核与启动流程 (Kernel & Boot Process)
*   **内核**: Linux Kernel (LTS 或最新稳定版)，包含必要的驱动程序。
*   **Init 系统**: OpenRC (Alpine) 或 systemd (Arch/Debian)。
*   **引导加载程序**: GRUB 或 systemd-boot。
*   **启动画面**: Plymouth (自定义 Kairo 品牌)。

## 3. 会话管理 (Session Management)
*   **显示管理器**: 无 (或极简的如 `greetd`)。
*   **会话**: Kairo Shell 是**唯一**的会话。
    *   配置在 `.xinitrc` (如果使用 Xwayland) 或 Wayland 会话文件中。
    *   自动登录到 `kairo` 用户。

## 4. Kairo Shell (合成器/Compositor)
*   **架构**: 基于 **Zig** + **wlroots** 的 Wayland Compositor。
*   **后端**: DRM/KMS (Direct Rendering Manager / Kernel Mode Setting)，用于无 X11 的硬件加速。
*   **输入**: `libinput` 用于处理键盘、鼠标和触摸事件。

## 5. 系统服务 (System Services)
*   **网络**: NetworkManager 或 systemd-networkd。
*   **音频**: PipeWire (现代、低延迟音频服务器)。
*   **蓝牙**: BlueZ。

## 6. 构建流程 (ISO 生成)
*   使用工具如 `mkinitcpio`, `archiso` (Arch), 或 `alpine-make-vm-image` (Alpine)。
*   自动化 CI 流水线生成可引导 ISO。

## 7. 路线图 (Roadmap)
- [ ] **第一阶段**: 在 Arch Linux 上原型验证 (在现有 Arch 上安装 Kairo Shell)。
- [ ] **第二阶段**: 创建自动登录到 Kairo Shell 的最小化 ISO。
- [ ] **第三阶段**: 自定义品牌 (启动画面, GRUB 主题)。
- [ ] **第四阶段**: 安装程序 (Calamares 或自定义)。
