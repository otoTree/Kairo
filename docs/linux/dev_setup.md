# Kairo Linux 开发指南 (macOS)

本指南概述了如何在 macOS 上开发和测试自定义的 Kairo Linux OS。

## 1. 前置条件 (Prerequisites)
你需要在 Mac 上安装以下工具。推荐使用 Homebrew。

```bash
# 1. 安装 Zig (语言与构建系统)
brew install zig

# 2. 安装 QEMU (用于在 Mac 上运行 Linux 内核的模拟器)
brew install qemu

# 3. 安装 Docker 或 OrbStack (用于构建 rootfs)
brew install --cask docker
# 或者
brew install orbstack
```

## 2. 架构概览 (Architecture Overview)
Kairo 的架构分为两层：

1.  **OS 层 (`/os`)**:
    - **语言**: Zig。
    - **职责**: 启动流程 (Init), 硬件抽象, 容器管理, 安全强制执行。
    - **目标**: 静态链接的 Linux 二进制 (`x86_64-linux-musl` 或 `aarch64-linux-musl`)。

2.  **Runtime 层 (`/src`)**:
    - **语言**: TypeScript (Bun)。
    - **职责**: Agent 逻辑, LLM 交互, 技能执行。
    - **目标**: 运行在 Bun 上的 JavaScript 包。

## 3. 开发工作流 (Development Workflow)

### 第一步：开发 OS 内核 (Zig)
OS 组件位于 `os/` 目录下。你可以利用 Zig 强大的工具链从 macOS 交叉编译到 Linux。

```bash
cd os
# 构建 Linux 版本 (Musl libc 用于静态链接)
zig build -Dtarget=aarch64-linux-musl # 适用于 Apple Silicon VM
# 或者
zig build -Dtarget=x86_64-linux-musl  # 适用于 Intel VM
```

### 第二步：构建根文件系统 (RootFS)
我们使用 Docker 来创建一个最小化的 Alpine Linux rootfs 并注入我们的 Zig 二进制文件。

*(脚本将添加至 `os/scripts/build-rootfs.sh`)*

### 第三步：使用 QEMU 测试
你可以使用 QEMU 直接在 macOS 上启动自定义的 Linux 内核。

```bash
# QEMU 命令示例 (ARM64)
qemu-system-aarch64 \
    -M virt -cpu host -accel hvf \
    -m 2G -smp 2 \
    -kernel path/to/vmlinuz \
    -initrd path/to/initramfs \
    -append "console=ttyAMA0" \
    -nographic
```

## 4. 下一步计划
- 在 `os/src/main.zig` 中实现基本的 Init 流程。
- 创建构建脚本以自动化 QEMU 启动。
