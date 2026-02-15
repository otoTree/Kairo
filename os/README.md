# Kairo OS 层 (Zig)

此目录包含 Kairo AgentOS 的底层操作系统组件，使用 **Zig** 编写。

## 架构 (Architecture)
Kairo OS 设计为一个极简、不可变的 Linux 系统，其中传统的用户空间被 **Kairo Kernel** 取代。

- **语言**: Zig (为了性能、安全和交叉编译)。
- **角色**:
    - 替代 `systemd` / `OpenRC` 作为 PID 1 (Init 系统)。
    - 管理硬件生命周期 (udev, 网络)。
    - 托管 `kairo-runtime` (TypeScript/Bun agent 运行时)。
    - 强制执行安全边界 (沙箱, Capabilities)。

## 目录结构 (Directory Structure)
- `src/`: Zig 组件的源代码。
    - `main.zig`: 入口点 (PID 1)。
- `build.zig`: 构建配置 (编译为静态二进制)。
- `dist/`: 内核镜像和 rootfs 的输出目录。

## 开发 (Development)
有关 macOS 上的设置说明，请参阅 [docs/linux/dev_setup.md](../docs/linux/dev_setup.md)。
