# Kairo 桌面环境 — 构建与部署指南

> 从源码编译到 Lima VM 运行的完整流程。

## 架构概览

部署到 VM 的产物包含三个组件：

| 组件 | 语言 | 编译方式 | 产物 |
|------|------|---------|------|
| River 合成器 + kairo-wm | Zig | Docker 交叉编译 (Alpine) | `os/dist/river`, `os/dist/kairo-wm` |
| Kairo 内核 | TypeScript | bun build 打包 JS bundle | `os/dist/kairo-kernel.js` |
| Bun 运行时 | — | 官方 musl 构建 | VM 内 `/usr/local/bin/bun-runtime` |

## 前置条件

**宿主机 (macOS)：**
- Docker Desktop
- [Lima](https://lima-vm.io/) (`brew install lima`)
- [Bun](https://bun.sh/) >= 1.3.6

**Lima VM：**
- 基于 `lima-kairo-river.yaml` 创建的 Alpine VM

## 1. 创建 Lima VM（首次）

```bash
limactl create --name kairo-river lima-kairo-river.yaml
limactl start kairo-river
```

VM 自动安装运行时依赖（wayland, wlroots, foot, chromium 等）。

首次还需手动安装以下额外依赖：

```bash
limactl shell kairo-river -- sudo apk add --no-cache \
  curl gcompat dbus cmd:seatd-launch

# 启用 D-Bus
limactl shell kairo-river -- sudo rc-update add dbus default
limactl shell kairo-river -- sudo rc-service dbus start
```

### 安装 Bun 运行时（musl 版）

bun 官方的 glibc 构建在 Alpine 上无法完整运行（JIT 依赖 glibc 特性），
需要通过官方安装脚本获取 musl 兼容版本：

```bash
limactl shell kairo-river -- sh -c '
  curl -fsSL https://bun.sh/install | bash
  sudo cp "$HOME/.bun/bin/bun" /usr/local/bin/bun-runtime
  sudo chmod +x /usr/local/bin/bun-runtime
  rm -rf "$HOME/.bun"
'
```

> **为什么不用 `bun build --compile --target=bun-linux-arm64`？**
> bun 1.3.x 的跨平台编译存在 bug，生成的二进制不会嵌入应用代码，
> 只输出裸 bun 运行时。因此采用 JS bundle + musl bun 运行时的方案。

## 2. 编译 Zig 组件（River + kairo-wm）

通过 Docker 在 Alpine 环境中编译，确保产物与 VM 的 musl/wlroots 版本匹配：

```bash
cd os && sh build_docker.sh
```

流程：
1. Docker 多阶段构建：`alpine:edge` + zig 编译工具链
2. `zig build -Doptimize=ReleaseSmall --sysroot /`
3. 从容器中提取 `river`、`kairo-wm`、`kairo-init` 到 `os/dist/`

产物：
- `os/dist/river` — Wayland 合成器
- `os/dist/kairo-wm` — 窗口管理器（连接 river_window_manager_v1 协议）
- `os/dist/init` — kairo-init（PID 1，非桌面环境必需）

## 3. 打包 TypeScript 内核

```bash
# 在项目根目录执行
bun build --outfile os/dist/kairo-kernel.js --target=bun ./src/index.ts
```

将整个 TypeScript 应用打包为单个 JS 文件（~2MB，681 模块）。

### 原生模块处理

以下原生模块已改为运行时动态导入，bundler 不会打包它们：

| 模块 | 用途 | 降级行为 |
|------|------|---------|
| `serialport` | 串口设备通信 | 静默跳过，设备功能不可用 |
| `lmdb` | 内存系统持久化 | 警告日志，MemCube 降级运行 |
| `hnswlib-node` | 向量搜索 | 警告日志，向量搜索不可用 |

### 数据库迁移

Kysely 的 `FileMigrationProvider` 依赖文件系统扫描迁移目录，
打包后该路径不存在。`DatabasePlugin` 内置了 fallback：
迁移失败时自动执行内联 `CREATE TABLE IF NOT EXISTS` 建表。

## 4. 部署到 VM

```bash
sh scripts/deploy-vm.sh
```

该脚本执行以下操作：
1. 检查 `os/dist/` 下三个产物是否存在
2. 通过 `limactl copy` 传输到 VM
3. 安装到 `/usr/local/bin/`（river, kairo-wm）
4. 部署 JS bundle 到 `/opt/kairo/kairo-kernel.js`
5. 安装 init 脚本到 `~/.config/river/init`
6. 安装 start-river 脚本到 `/usr/local/bin/start-river`

> `deploy-vm.sh` 目前不包含 JS bundle 和 bun-runtime 的部署。
> 首次部署需手动执行：
> ```bash
> limactl copy os/dist/kairo-kernel.js kairo-river:/tmp/kairo-kernel.js
> limactl shell kairo-river -- sh -c '
>   sudo mkdir -p /opt/kairo
>   sudo cp /tmp/kairo-kernel.js /opt/kairo/kairo-kernel.js
>   rm /tmp/kairo-kernel.js
>   # 创建启动脚本
>   sudo tee /usr/local/bin/kairo-kernel > /dev/null << "SCRIPT"
> #!/bin/sh
> exec /usr/local/bin/bun-runtime /opt/kairo/kairo-kernel.js "$@"
> SCRIPT
>   sudo chmod +x /usr/local/bin/kairo-kernel
> '
> ```

## 5. 启动桌面环境

```bash
limactl shell kairo-river -- start-river
```

启动链：
```
start-river.sh
  ├─ 停止系统 seatd（避免与 seatd-launch 冲突）
  ├─ 设置环境变量（XDG_RUNTIME_DIR, WLR_RENDERER=pixman 等）
  └─ seatd-launch -- river -log-level debug
       └─ river 执行 ~/.config/river/init
            ├─ kairo-wm（后台）
            ├─ sleep 1
            ├─ kairo-kernel（后台，即 bun-runtime kairo-kernel.js）
            └─ 回退：如果内核未启动，打开 foot 终端
```

通过 VNC 查看桌面：
```bash
cat ~/.lima/kairo-river/vncdisplay
# 使用 VNC 客户端连接显示的地址
```

## 6. 快速迭代

### 只改了 Zig 代码

```bash
cd os && sh build_docker.sh && cd .. && sh scripts/deploy-vm.sh
```

### 只改了 TypeScript 代码

```bash
bun build --outfile os/dist/kairo-kernel.js --target=bun ./src/index.ts
limactl copy os/dist/kairo-kernel.js kairo-river:/tmp/k.js
limactl shell kairo-river -- sudo cp /tmp/k.js /opt/kairo/kairo-kernel.js
```

### 重启桌面环境

在 VM 内或通过 limactl：
```bash
limactl shell kairo-river -- sh -c '
  sudo pkill -9 river; sudo pkill -9 seatd
  sleep 2; sudo rm -f /run/seatd.sock
'
limactl shell kairo-river -- start-river
```

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| `seatd.sock refusing to start` | 上次 seatd 未清理 | `sudo rm -f /run/seatd.sock` |
| `DRM master: Resource busy` | 上次 river 未完全退出 | `sudo pkill -9 river; sleep 2` |
| `kairo-kernel: not found` | init 脚本 PATH 缺失 | 确认 init 第一行有 `export PATH="/usr/local/bin:$PATH"` |
| bun 显示帮助而非运行应用 | 跨平台编译 bug | 使用 JS bundle + musl bun-runtime 方案 |
| `ENOENT migrations` | 打包后迁移目录不存在 | 已内置 fallback，正常降级 |
| `connect ENOENT dbus` | D-Bus 未安装/启动 | `sudo apk add dbus && sudo rc-service dbus start` |
