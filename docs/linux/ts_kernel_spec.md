# Kairo Kernel (TypeScript) 功能规范

## 1. 概述 (Overview)

`Kairo Kernel` 是运行在用户空间 (Ring 0 Managed) 的核心逻辑层，使用 **TypeScript** 编写，运行于 **Bun** 运行时。它作为 Systemd 的上层编排器，负责 AgentOS 的高层资源调度、设备抽象和业务逻辑。

**核心职责**:
1.  **IPC 中心**: 提供统一的系统调用接口 (Kernel IPC)。
2.  **进程管理**: 编排 Skill 和 Agent 进程，提供沙箱环境。
3.  **设备管理**: 统一硬件访问接口，管理设备独占权。
4.  **服务编排**: 通过 D-Bus 控制 Systemd，管理系统服务。
5.  **事件总线**: 分发系统级事件，连接各个领域模块。

**源码位置**: `/src/domains/kernel/`

## 2. Kernel IPC 系统

Kernel IPC 是 AgentOS 的“系统调用”入口，外部进程（二进制 Skill、CLI 工具、UI 渲染器）通过它与内核交互。

### 2.1 传输层
-   **协议**: Unix Domain Socket (UDS).
-   **地址**: `/tmp/kairo-kernel.sock`.
-   **格式**: Frame Header (8 bytes) + MsgPack Payload. (详见 [Kernel IPC Spec](../architecture/kernel-ipc-spec.md)).

### 2.2 核心方法 (Syscalls)

内核必须实现并暴露以下 RPC 方法：

#### System 命名空间
-   `system.get_info()`: 获取 OS 版本、Kernel 版本、Uptime。
-   `system.get_metrics()`: 获取 CPU/Mem 使用率 (需读取 `/proc`).
-   `system.shutdown()`: 请求关机 (通过 D-Bus 调用 Systemd `PowerOff`).
-   `system.reboot()`: 请求重启 (通过 D-Bus 调用 Systemd `Reboot`).

#### Process 命名空间
-   `process.spawn(cmd, args, opts)`: 启动一个子进程。
    -   支持 `opts.env` (环境变量注入).
    -   支持 `opts.cwd`.
    -   返回 `pid` 和 `ipc_channel_id`.
-   `process.kill(pid, signal)`: 发送信号给进程。
-   `process.list()`: 列出当前由 Kernel 管理的子进程树。
-   `process.subscribe_stdio(pid)`: (流式) 订阅进程的 stdout/stderr 输出流。

#### Service 命名空间 (Systemd Bridge)
-   `service.start(name)`: 启动系统服务 (如 `docker`, `postgresql`).
-   `service.stop(name)`: 停止服务。
-   `service.restart(name)`: 重启服务。
-   `service.status(name)`: 获取服务状态 (Active/Inactive/Failed).

#### Device 命名空间
-   `device.list()`: 列出所有已发现的设备 (Registry 中的设备).
-   `device.claim(deviceId, consumerId)`: 申请设备独占权。
-   `device.release(deviceId, consumerId)`: 释放设备。
-   `device.send(deviceId, data)`: 向设备发送数据 (如 Serial Write).
-   `device.subscribe(deviceId)`: (流式) 订阅设备输入数据 (如 Serial Read).

## 3. 进程管理器 (Process Manager)

负责管理所有 Ring 3 (用户空间) 进程的生命周期。

### 3.1 进程树维护
-   内部维护一个 `Map<Pid, ProcessMetadata>`。
-   **Metadata**: 包含启动时间、所属 Agent、资源限制、IPC 通道状态等。
-   **生命周期**: 监听进程 `exit` 事件，自动清理元数据并触发 `process.exited` 事件。

### 3.2 沙箱与隔离 (Sandbox Integration)
在 `spawn` 时应用沙箱策略：
-   **文件系统**: 使用 `chroot` 或通过 LD_PRELOAD/seccomp 限制文件访问 (MVP 阶段可能仅通过应用层逻辑限制)。
-   **网络**: 限制出站 IP/端口。
-   **资源**: 设置 cgroups (Linux) 或 ulimit。

### 3.3 PTY 支持 (Terminal)
-   为了支持交互式 CLI 工具 (如 `vim`, `htop`, `ssh`)，Process Manager 必须支持 **PTY (Pseudo-Terminal)** 分配。
-   使用 `node-pty` 或 Bun 的原生 FFI 调用 `openpty`。
-   将 PTY 的 Master 端暴露给前端 (UI Shell)，Slave 端连接到子进程。

### 3.4 Linux Sandbox & Namespaces
Process Manager 集成 `src/domains/sandbox` 模块，利用 **Linux Namespaces** 和 **Seccomp** 提供强隔离环境。

#### 核心机制 (Bubblewrap)
我们使用 `bwrap` (Bubblewrap) 作为底层沙箱引擎，它通过 `unshare()` 系统调用创建以下 Namespace：

*   **User Namespace**: 默认启用。将沙箱内的 `uid 0` 映射为宿主机的当前用户，使非特权进程也能创建其他 Namespace。
*   **Mount Namespace**: 创建全新的文件系统视图。
    *   基础层: `--ro-bind / /` (只读根目录)。
    *   临时层: `--tmpfs /tmp`, `--tmpfs /run`。
    *   设备层: `--dev /dev` (创建最小 `/dev` 节点)。
    *   绑定层: 根据 `fsConfig` 动态绑定用户允许的读写目录。
*   **PID Namespace**: `--unshare-pid`。沙箱内进程 PID 从 1 开始，无法看到宿主机或其他容器的进程。
*   **Network Namespace**: `--unshare-net`。
    *   默认: 无网络访问 (只有 loopback)。
    *   桥接模式: 通过 `socat` 将宿主机的 HTTP/SOCKS 代理 Socket 映射进沙箱，实现受控的网络访问。
*   **IPC Namespace**: `--unshare-ipc`。隔离 System V IPC 和 POSIX 消息队列。
*   **UTS Namespace**: `--unshare-uts`。允许沙箱拥有独立的主机名 (默认为 `kairo-sandbox`)。

#### 系统调用过滤 (Seccomp BPF)
除了 Namespace 隔离，Kernel 还通过 `apply-seccomp` 加载 BPF 过滤器：
*   **默认策略**: 允许大部分 syscall。
*   **关键限制**: 拦截 `socket(AF_UNIX)` 创建，防止恶意程序通过构建新的 Unix Socket 绕过网络隔离或攻击宿主机服务。

## 4. 设备管理器 (Device Manager)

提供统一的硬件抽象层 (HAL)。

### 4.1 设备发现 (Discovery)
-   **后端**:
    -   **Linux**: 监听 udev 事件 (通过 `netlink` 或监听 `udevadm monitor` 输出)。
    -   **macOS (Dev)**: 轮询 `/dev/cu.*` 或使用 `system_profiler`。
-   **规范化**: 将不同 OS 的设备路径映射为统一的 Device ID (如 `serial:usb-1-1`).

### 4.2 驱动模型 (Driver Model)
-   **Native Drivers**: 内置驱动 (Serial, GPIO, Camera)。
-   **External Drivers**: 允许通过 IPC 注册外部驱动 (即某个 Skill 进程作为驱动)。

### 4.3 访问控制 (Access Control)
-   实现 **互斥锁** 机制：同一时间只有一个 Agent/Process 能 `claim` 一个设备。
-   记录当前 Holder，防止争用冲突。

## 5. 事件总线 (Event Bus)

虽然 Event Bus 逻辑上属于 Ring 0 Core，但它在 TS Kernel 中实现。

### 5.1 系统事件
Kernel 必须产生以下关键事件：
-   `kairo.system.ready`: Kernel 启动完成。
-   `kairo.device.added` / `kairo.device.removed`: 硬件热插拔。
-   `kairo.process.started` / `kairo.process.exited`: 进程生命周期。
-   `kairo.kernel.panic`: (严重) Kernel 内部错误。

### 5.2 持久化
-   集成 `MemCube` (SQLite)，确保关键系统事件被记录，供后续审计和 Agent 回忆。

## 6. 系统服务管理 (System Services)

鉴于 Kairo 决定与 Systemd 共存，TS Kernel 将充当 Systemd 的**上层代理**，而不是替代它。

### 6.1 架构策略
*   **PID 1**: Systemd.
*   **Controller**: Kairo Kernel 通过 **D-Bus** 协议控制 Systemd。
*   **API**: Kernel 暴露统一的 `service.start/stop` 接口，底层映射到 `systemctl start/stop`。

### 6.2 D-Bus 集成
TS Kernel 需要连接到 System Bus。
*   **Socket**: `/run/dbus/system_bus_socket`.
*   **Interface**: `org.freedesktop.systemd1.Manager`.
*   **Methods**:
    *   `StartUnit(name, mode)`
    *   `StopUnit(name, mode)`
    *   `RestartUnit(name, mode)`
    *   `GetUnitFileState(name)`

### 6.3 容器运行时集成
由于 Systemd 负责管理 `dockerd` 或 `k3s` 服务，Kernel 不再直接 spawn 它们。
*   **Docker**: 确保 `docker.service` 已启用 (`systemctl enable docker`)。Kernel 只需检查 socket 是否就绪。
*   **K3s**: 确保 `k3s.service` 已启用。

## 7. 软件安装与包管理 (Package Management)

### 7.1 策略概览
由于 Systemd 的存在，通过包管理器安装的服务可以无缝工作。
1.  **系统层 (apt/pacman)**: 安装驱动、工具和服务。`apt install nginx` 后，systemd 会自动接管。
2.  **服务层 (Docker)**: 依然推荐 Docker 部署应用，保持环境清洁。
3.  **应用层 (AppImage/Flatpak)**: 推荐用于 GUI 软件。

### 7.2 场景示例

#### 场景 A: 安装 Google Chrome
1.  `apt-get install google-chrome-stable` (通过 Kernel 的 `system.package.install` 调用)。
2.  安装后，Chrome 作为一个普通二进制存在。
3.  Agent 可以通过 `process.spawn("google-chrome", ["--ozone-platform=wayland"])` 启动它。

#### 场景 B: 安装 PostgreSQL
1.  `apt-get install postgresql`。
2.  Systemd 自动启动 `postgresql.service`。
3.  Kernel 无需额外配置，Agent 可以直接连接 `localhost:5432`。
4.  如果 Agent 需要重启数据库，调用 `service.restart("postgresql")` -> D-Bus -> Systemd。
