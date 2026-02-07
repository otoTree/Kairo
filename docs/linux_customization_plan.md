# KairoOS: 深度系统接管与 Linux 定制化方案

## 1. 核心理念：从 "App on Linux" 到 "Kairo IS Linux"

目前的 Kairo 架构是一个运行在标准 Linux 发行版（如 Ubuntu/Debian）上的应用层程序。为了实现真正的“Agent OS”愿景，我们需要向下沉淀，构建一个专用的、极简的、以智能体为中心的 Linux 发行版 —— **KairoOS**。

在此架构中，Linux 内核与 Kairo Runtime 将紧密耦合，操作系统不再是为了运行通用软件，而是为了**服务 Agent 的感知与行动**。

## 2. 构建体系 (Build System)

为了完全掌控系统，我们将不再依赖现有的发行版，而是使用嵌入式构建工具生成自定义镜像。

### 2.1 技术选型：Buildroot vs Yocto
我们建议初期使用 **Buildroot**，后期根据生态需求迁移至 **Yocto**。

*   **Buildroot**: 简单、高效，适合构建单一用途的嵌入式系统。我们可以快速生成一个只有几十MB的根文件系统，其中只包含 Kernel、libc、Node.js/Bun 和 Kairo 核心代码。
*   **Yocto (OpenEmbedded)**: 更复杂，但支持层级化管理（Layers），适合支持多种硬件板卡（BSP）和复杂的软件包管理。

### 2.2 镜像构成
一个 KairoOS 镜像将包含：
*   **Kernel**: 经过裁剪和优化的 Linux Kernel (5.15+ LTS)。
*   **RootFS**: 只读的根文件系统 (SquashFS/EROFS)。
*   **Runtime**: 预编译的 Bun/Node.js 环境。
*   **Kairo Core**: 核心业务代码。

---

## 3. 启动流程重构 (Boot Sequence Takeover)

目标是让 Kairo 尽可能早地接管系统控制权，减少中间环节。

### 3.1 传统的启动链
`BIOS/UEFI` -> `Bootloader (GRUB/U-Boot)` -> `Kernel` -> `systemd (PID 1)` -> `Multi-user Target` -> `Kairo Service`

### 3.2 KairoOS 启动链 (PID 1 Strategy)
`Bootloader` -> `Kernel` -> **`Kairo Init (PID 1)`** -> `Agent Runtime`

我们将编写一个极简的 **Kairo Init** (使用 Rust 或 C)，替代庞大的 systemd。
*   **职责**:
    1.  挂载必要的文件系统 (`/proc`, `/sys`, `/dev`, `/var` 等)。
    2.  初始化网络 (DHCP/Static)。
    3.  启动硬件看门狗 (Hardware Watchdog)。
    4.  **直接启动 Kairo Agent Runtime**。
    5.  如果 Runtime 崩溃，由 Init 负责重启或回滚。

这消除了 systemd 的巨大开销，将启动时间压缩到数秒内。

---

## 4. 文件系统与更新机制 (Filesystem & OTA)

为了保证 Agent 在自我修改或安装 Skill 时不会破坏系统核心，必须采用**不可变基础设施**的设计。

### 4.1 分区布局 (A/B Partitioning)
```
[ Bootloader ]
[ Kernel A ] [ RootFS A (Read-Only) ]  <-- Active
[ Kernel B ] [ RootFS B (Read-Only) ]  <-- Standby (Update Target)
[ User Data (Read-Write) ]             <-- /var/kairo (Logs, Memories, Installed Skills)
```

### 4.2 原子更新 (Atomic OTA)
*   系统更新通过下载新的 RootFS 镜像写入备用分区（Slot B）。
*   更新完成后，设置 Bootloader 下次从 Slot B 启动。
*   如果启动失败（看门狗超时），自动回滚到 Slot A。
*   **Agent 的能力**: Agent 可以通过调用 `kairo.system.update()` 触发自我升级，这在底层只是简单的块设备写入操作。

---

## 5. 内核级能力增强 (Kernel Customization)

### 5.1 实时性 (Real-Time Preemption)
对于需要控制机械臂、无人机等硬件的场景，我们将应用 **PREEMPT_RT** 补丁，将 Linux 转换为实时操作系统 (RTOS)，确保 Agent 的控制指令能在确定性时间内执行。

### 5.2 硬件直通与驱动裁剪
*   **移除**: 移除所有图形栈 (X11/Wayland/DRM)，除非用于 Debug UI。移除打印机、扫描仪等无关驱动。
*   **集成**: 将常用的传感器驱动（I2C/SPI/UART）、SDR 驱动、神经网络加速器（NPU）驱动编译进内核，而不是作为模块加载，确保存储即插即用。

### 5.3 智能体专用调度器 (Agent-Aware Scheduler)
(高级目标) 修改 CFS (Completely Fair Scheduler)，让 Kernel 能够理解 "Agent Task" 的优先级。
*   关键感知任务 (如 "Visual Processing") 获得更高的时间片。
*   后台整理任务 (如 "Memory Consolidation") 设置为 `SCHED_IDLE`。

---

## 6. 安全与隔离 (Security & Isolation)

### 6.1 Skill 容器化
虽然没有 Docker (过于庞大)，但我们可以利用 Linux 原生的 Namespaces 和 Cgroups 实现轻量级容器化。
*   每个 **Binary Skill** 都在独立的 Mount Namespace 和 Network Namespace 中运行。
*   利用 **Cgroups v2** 严格限制 Skill 的 CPU 和内存使用率，防止耗尽系统资源导致 Agent 核心崩溃。

### 6.2 权能机制 (Capabilities)
Kairo Runtime 不需要以 `root` 运行。我们将赋予它特定的 Linux Capabilities：
*   `CAP_NET_ADMIN`: 配置网络。
*   `CAP_SYS_ADMIN`: 挂载文件系统（用于 Skill 沙盒）。
*   `CAP_SYS_TIME`: 修改时间。
*   `CAP_KILL`: 管理子进程。

---

## 7. 二进制与终端交互环境 (Headless Binary Environment)

由于 KairoOS 采用无头 (Headless) 设计，不需要考虑 X11/Wayland 等图形栈兼容性。重点在于支持 Agent 运行和控制各种二进制工具。

### 7.1 二进制技能执行 (Skill Binaries)
Skill 可以携带静态编译的二进制文件（Go/Rust/C++），Agent 将其视为一种原生能力。
*   **分发格式**: Skill 包中包含 `bin/linux-arm64/executable`。
*   **执行方式**: Agent 通过 `spawn()` 直接调用，通过 stdin/stdout 交互，或者通过 Unix Domain Socket 进行高性能通信。
*   **示例**: 一个 SDR Skill 包含 `rtl_sdr` 二进制，Agent 启动它并读取二进制数据流。

### 7.2 虚拟终端接口 (Virtual Terminal Interface)
Agent 需要像人类一样使用 Shell 工具。
*   **PTY 机制**: 系统提供 `node-pty` 或类似的原生绑定，允许 Agent 创建伪终端会话。
*   **Tool**: 提供 `Terminal` 工具，支持 `run_command`, `write_input`, `read_output`。
*   **场景**: Agent 发现没有 `ffmpeg`，它不能打开浏览器下载，但它可以尝试运行 `static-ffmpeg` 或通过 Nix 获取。

### 7.3 扩展工具链 (Toolchain Extension)
虽然基础系统是只读的，但 Agent 需要获取新工具的能力。
*   **Portable CLIs**: 支持直接下载并运行静态编译的 CLI 工具（如 `yt-dlp`, `kubectl`）。
*   **Nix (Optional)**: 对于复杂依赖软件，挂载 `/nix` 卷，使用 Nix 包管理器安装，不污染宿主系统。
*   **OCI 容器运行时 (OCI Runtime)**: 支持运行符合 OCI 标准的容器镜像。虽然 Docker 是典型代表，但在 KairoOS 中我们优先推荐 **Podman** (无守护进程) 或 **Containerd** (轻量级)，用于编排数据库、中间件等复杂服务。

### 7.4 动态库加载与 FFI (Dynamic Library Loading)

除了独立进程的二进制，KairoOS 还支持 Agent 动态加载共享库（Linux `.so` 或 Windows DLL via Wine），以实现极低延迟的函数调用。

*   **技术基础**: 利用 Runtime 的 FFI (Foreign Function Interface) 能力（如 `bun:ffi` 或 `node-ffi-napi`）。
*   **适用场景**: 密集计算任务（如加密、图像处理、矩阵运算），无需启动新进程，直接在 Agent 内存空间执行。
*   **实现机制**:
    1.  Skill 声明导出函数签名 (Signature)。
    2.  Runtime 动态 `dlopen()` 目标库。
    3.  Agent 将 JavaScript 对象（Buffer/Array）直接传递给 C 函数指针。
*   **兼容性**: 
    *   **Native**: 直接加载 Linux `.so`。
    *   **Legacy DLL**: 通过集成的 WineLib 包装器加载 Windows DLL（仅限特定无 GUI 库）。

### 7.5 WebAssembly (Wasm)
WebAssembly 是 Agent OS 理想的沙盒化二进制格式。
*   **优势**: 跨平台（一次编译，到处运行）、启动速度极快（微秒级）、强隔离（内存安全）。
*   **运行时**: 集成 `wasmtime` 或 V8 Wasm 引擎。
*   **场景**: 不受信任的第三方 Skill 插件，或者需要热加载的计算模块。

### 7.6 eBPF (Kernel Sandbox)
为了实现极致的系统监控与控制，Agent 需要通过 eBPF 将逻辑注入到内核中。
*   **机制**: Agent 可以加载编译好的 eBPF 字节码到内核，挂载到特定的 Tracepoint 或 Socket。
*   **用途**: 实时网络流量分析、系统调用监控、高性能包过滤。
*   **安全**: eBPF 验证器确保注入的代码不会导致内核崩溃。

## 8. 关键基础设施补全 (Critical Infrastructure)

为了让 KairoOS 成为一个功能完备的系统，我们需要填补“内核”与“应用”之间的真空地带。

### 8.1 极简网络栈 (Native Networking)
摒弃 NetworkManager，采用更轻量级的方案：
*   **WiFi**: 集成 `iwd` (Intel Wireless Daemon)，它比 `wpa_supplicant` 更快且依赖更少。Agent 通过 D-Bus 控制连接。
*   **IP 配置**: 内置极简 DHCP 客户端或直接使用 `systemd-networkd` 的独立替代品。
*   **4G/5G**: 集成 `ModemManager`，支持通过 AT 指令或 QMI/MBIM 协议控制蜂窝模块。

### 8.2 状态持久化与配置 (State Management)
由于 RootFS 是只读的，我们需要明确“状态”的存储位置。
*   **OverlayFS**: 在只读 RootFS 之上挂载一个可写的 `upperdir` (位于 Data 分区)。这样 Agent 修改 `/etc/hostname` 时看起来像是在修改系统文件，但实际上是写在 Overlay 层中。
*   **Config Partition**: 专门的 `/config` 分区，存储结构化的系统配置 (JSON/TOML)，Kairo Init 启动时读取并应用。

### 8.3 日志与可观测性 (Logs & Telemetry)
*   **日志采集**: 没有 `journald`。Kairo Init 负责捕获 stdout/stderr，并通过环形缓冲区 (Ring Buffer) 存储在内存中。
*   **持久化**: 关键错误写入 `/var/log/crash.log`。
*   **云端同步**: Agent 空闲时自动压缩上传日志到云端。
*   **调试 Shell**: 保留 Serial Console (UART) 作为最后的调试手段。

### 8.4 硬件热插拔 (Hardware Hotplug)
*   **Netlink Listener**: Kairo Kernel 模块直接监听 Kernel Netlink Socket (代替 udev)，捕获 `add/remove` 事件。
*   **自动挂载**: 识别 USB 存储设备并自动挂载到 `/media/usb`，同时发送事件通知 Agent。

---

## 9. 实施路线图

1.  **Phase 1: 原型 (RootFS)**
    *   使用 Buildroot 构建一个包含 Node.js 的最小 Linux 镜像。
    *   在 QEMU 中运行 Kairo。

2.  **Phase 2: Init 接管**
    *   编写 `kairo-init` (Rust)，替代 `/sbin/init`。
    *   实现崩溃自动重启。

3.  **Phase 3: 硬件实战**
    *   移植到 Raspberry Pi 或 Rockchip 开发板。
    *   实现 A/B 分区更新。

4.  **Phase 4: 内核深度定制**
    *   应用 RT 补丁。
    *   实现 Cgroup 资源控制集成。
