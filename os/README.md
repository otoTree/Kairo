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

### 构建指南 (Build Guide)

项目包含本地化的 River 源码 (`src/shell/river`) 和第三方依赖 (`vendor/`)。

由于 macOS 不支持 Wayland 和 DRM/KMS，且交叉编译涉及复杂的系统库依赖，**强烈建议在 Linux 环境中构建** (例如使用 Lima 或 Docker)。

#### 在 macOS 上使用 Docker 构建 (推荐)

如果您不想安装 Lima 或复杂的依赖，可以使用 Docker 进行构建。

1.  确保已安装 Docker Desktop。
2.  在 `os/` 目录下运行构建脚本:
    ```bash
    ./build_docker.sh
    ```
3.  构建产物将输出到 `os/dist/` 目录:
    - `init` (Kairo PID 1)
    - `river` (Compositor)
    - `kairo-wm` (Window Manager)

#### 在 macOS 上使用 Lima 构建

1.  启动 Lima 实例:
    ```bash
    limactl start default
    ```
2.  进入 shell:
    ```bash
    limactl shell default
    ```
3.  在 Linux 中安装依赖 (Ubuntu/Debian):
    ```bash
    sudo apt install zig libwayland-dev libwlroots-dev libxkbcommon-dev libpixman-1-dev libinput-dev libevdev-dev
    ```
4.  构建:
    ```bash
    # 假设源码挂载在 /Users/hjr/...
    cd /path/to/kairo/os
    zig build
    ```

注意：如果必须在 macOS 上构建，请确保已安装所有 vendor 依赖，并尝试使用 `zig build -Dtarget=x86_64-linux-musl`，但这可能因缺少系统库而失败。

