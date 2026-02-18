# Kairo River VM 开发环境

在 macOS 上通过 Lima + QEMU 运行 Kairo River Wayland 合成器，使用 VNC 查看图形输出。

## 架构

```
macOS (宿主机)
├── Docker 编译 → os/dist/ (musl aarch64 二进制)
├── Lima (kairo-river VM, Alpine Linux)
│   ├── QEMU + VNC 图形输出
│   ├── River (Wayland 合成器)
│   ├── kairo-wm (外部窗口管理器, Master/Stack 布局)
│   └── foot (终端模拟器)
└── VNC 客户端 → 127.0.0.1:5900
```

## 前置条件

```bash
brew install lima qemu
# Docker 或 OrbStack (用于编译)
brew install --cask docker
```

## 快速开始

### 1. 编译二进制

```bash
cd os
./build_docker.sh
# 产出: os/dist/river, os/dist/kairo-wm, os/dist/init
```

Docker 使用 Alpine Edge 环境编译，产出 musl-linked aarch64 二进制。

### 2. 创建 VM

```bash
limactl create --name kairo-river lima-kairo-river.yaml
limactl start kairo-river
```

VM 基于 Alpine Linux，自动安装 Wayland/wlroots 运行时依赖、foot 终端、seatd。

### 3. 部署二进制到 VM

```bash
limactl shell kairo-river -- ~/Desktop/Kairo/scripts/deploy-vm.sh
```

脚本将 `os/dist/` 中的二进制复制到 VM 的 `/usr/local/bin/`，并部署 River init 配置到 `~/.config/river/init`。

### 4. 启动 River

```bash
limactl shell kairo-river -- start-river
```

River 启动后会自动执行 init 脚本，启动 kairo-wm 和 3 个 foot 终端窗口。

### 5. VNC 连接

VNC 地址查看：
```bash
cat ~/.lima/kairo-river/vncdisplay
```

使用 macOS 自带的 Screen Sharing 或任意 VNC 客户端连接，默认地址 `127.0.0.1:5900`。

## 关键文件

| 文件 | 说明 |
|------|------|
| `lima-kairo-river.yaml` | Lima VM 配置模板 (Alpine + Wayland 依赖) |
| `scripts/deploy-vm.sh` | 部署二进制和配置到 VM |
| `scripts/start-river.sh` | VM 内启动 River 的环境配置 |
| `os/src/shell/config/init` | River init 脚本 (快捷键、kairo-wm、自动启动终端) |
| `os/src/wm/main.zig` | kairo-wm 窗口管理器 (Master/Stack 布局) |
| `os/build_docker.sh` | Docker 编译脚本 |
| `os/Dockerfile` | 编译环境定义 (Alpine Edge + Zig) |

## VM 管理

```bash
limactl list                    # 查看 VM 状态
limactl shell kairo-river       # 进入 VM shell
limactl stop kairo-river        # 停止 VM
limactl start kairo-river       # 启动 VM
limactl delete kairo-river      # 删除 VM
```

## 常见问题

**VNC 黑屏**
检查 kairo-wm 日志：`limactl shell kairo-river -- cat /tmp/kairo-wm.log`

**River 启动失败 "no input devices"**
`start-river.sh` 已设置 `WLR_LIBINPUT_NO_DEVICES=1`，如果手动启动需要加上此环境变量。

**foot 终端崩溃 "failed to match font"**
安装字体：`limactl shell kairo-river -- sudo apk add font-dejavu fontconfig`

**二进制无法运行 "not found"**
确认 VM 是 Alpine (musl)，Docker 编译产出的是 musl-linked 二进制，不兼容 Debian/Ubuntu (glibc)。
