# Kairo Session Manager (Zig) 功能规范

## 1. 概述 (Overview)

为了兼容标准的 Linux 生态（如 Docker, NetworkManager, apt 服务），Kairo 决定保留 **Systemd** 作为 PID 1。

原 `kairo-init` 重新定位为 **Kairo Session Manager** (`kairo-session`)。它作为一个 Systemd Service 运行，负责：
1.  **Runtime 托管**: 启动并守护 Kairo Kernel (TypeScript)。
2.  **图形栈启动**: 启动 Wayland Compositor (Kairo Shell)。
3.  **看门狗**: 监控核心组件健康状态。

**源码位置**: `/os/src/main.zig`

## 2. 启动方式 (Systemd Integration)

Kairo Session Manager 由 Systemd 启动，通常配置为自动登录用户的用户服务，或系统级服务。

### 2.1 Systemd Unit 文件 (`kairo.service`)
推荐将其配置为系统级服务，独占 TTY / DRM 资源。

```ini
[Unit]
Description=Kairo AgentOS Session Manager
After=network.target systemd-user-sessions.service plymouth-quit-wait.service
Conflicts=getty@tty1.service gdm.service lightdm.service

[Service]
ExecStart=/usr/bin/kairo-session
Restart=always
RestartSec=3
# 关键：允许访问 DRM/KMS 和 Input 设备
User=root
Group=root
# 关键：设置环境变量
Environment=KAIRO_ENV=production
Environment=XDG_SESSION_TYPE=wayland
# 调整 OOM 评分，避免被杀
OOMScoreAdjust=-1000

[Install]
WantedBy=multi-user.target
```

## 3. 核心职责 (Responsibilities)

### 3.1 启动 Kairo Kernel (TS Runtime)
-   **Command**: `bun run /usr/lib/kairo/src/index.ts`
-   **IPC**: 创建 `/tmp/kairo-kernel.sock` 的目录权限，确保 TS Kernel 可以绑定。
-   **Watchdog**: 监控 Bun 进程，如果崩溃则重启。

### 3.2 启动 Wayland Compositor (Graphical Shell)
Kairo Shell 是一个 Wayland Compositor（基于 Smithay/Rust 或 wlroots）。
-   **依赖**: 等待 `kairo.system.ready` 信号（可选，或并行启动）。
-   **Command**: `/usr/bin/kairo-shell`
-   **Environment**: 注入 `WAYLAND_DISPLAY=wayland-1`。
-   **Socket Handoff**: 监听 Wayland Socket 并传递给 Compositor（可选高级特性）。

### 3.3 故障恢复 (Rescue Mode)
由于 Systemd 已经是 PID 1，我们不需要自己实现底层的 Rescue Shell。
-   如果 Kairo 连续崩溃，Zig 进程退出。
-   Systemd 根据 `Restart=always` 尝试重启。
-   如果达到 Systemd 的 `StartLimitBurst`，Systemd 会停止服务。
-   **Fallback**: 此时系统回退到 TTY 登录界面（如果启用了 getty）。

## 4. 移除的职责 (Deprecated)

由于 Systemd 接管了系统初始化，Zig 组件**不再**负责：
*   ❌ 挂载 `/proc`, `/sys`, `/dev`, `/tmp` (Systemd 已做)。
*   ❌ 回收僵尸进程 (Systemd 是 PID 1，它会做)。
*   ❌ 设置 Hostname, Loopback 网络 (Systemd-networkd/NetworkManager 做)。
*   ❌ 加载内核模块 (Systemd-modules-load 做)。

## 5. 硬件交互变更
*   **Uevent**: 不再监听 Netlink。TS Kernel 可以直接通过 D-Bus 监听 `systemd-udevd` 的信号，或者使用 `udevadm monitor`。

## 6. 开发与部署

### 6.1 编译
仍然推荐静态编译，方便分发。
```bash
zig build -Dtarget=x86_64-linux-musl -Doptimize=ReleaseSmall
```

### 6.2 安装
1.  复制二进制: `/usr/bin/kairo-session`
2.  复制 Unit 文件: `/etc/systemd/system/kairo.service`
3.  启用服务: `systemctl enable kairo.service`
4.  设置默认 Target: `systemctl set-default multi-user.target`
