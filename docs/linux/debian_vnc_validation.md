# Debian VNC 实例验证流程（Kairo WM）

本文档用于在 Debian VNC 的 Lima 实例中验证 Kairo WM 的主副窗口布局。

## 1. 前置条件

- macOS 已安装 Lima
- 已创建并启动 `kairo-vnc` 实例（Debian 12，VNC 模式）
- 已构建出 `os/dist/` 产物（`kairo-wm`、`river`、`init`）

## 2. 启动实例

在宿主机执行：

```bash
LIMA_HOME=/Users/hjr/Desktop/Kairo/.lima limactl start --tty=false kairo-vnc
```

如果尚未创建实例，先执行：

```bash
LIMA_HOME=/Users/hjr/Desktop/Kairo/.lima limactl create --tty=false --name=kairo-vnc /Users/hjr/Desktop/Kairo/lima-debian-vnc.yaml
```

## 3. 连接 VNC

- VNC 地址：`127.0.0.1:5900`（显示号 `:0`）
- VNC 密码：读取文件 `/Users/hjr/Desktop/Kairo/.lima/kairo-vnc/vncpassword`

## 4. 将构建产物拷入实例

在宿主机执行：

```bash
LIMA_HOME=/Users/hjr/Desktop/Kairo/.lima limactl shell kairo-vnc -- bash -lc \
"mkdir -p ~/kairo-run/bin && cp -a /Users/hjr/Desktop/Kairo/os/dist/* ~/kairo-run/bin/ && chmod +x ~/kairo-run/bin/*"
```

## 5. 在实例内启动 River + Kairo WM

在实例内执行：

```bash
cd ~/kairo-run
./bin/river &
./bin/kairo-wm &
```

如果 River 已经在运行，先结束：

```bash
pkill river
pkill kairo-wm
```

## 6. 布局验证步骤

1. 打开第一个终端窗口（xterm）
2. 再打开第二、第三个终端窗口
3. 观察布局是否满足：
   - 单窗口占满可用区域
   - 多窗口时，首个窗口在左侧主区，其他窗口在右侧栈区等高平铺

## 7. 验证通过标准

- 2 个及以上窗口时，布局稳定为主副分区
- 增加或关闭窗口时布局可自动更新

## 8. 故障排查：display output is not active

### 根因

Lima 默认使用 `cloud` 内核（`*-cloud-arm64`），该内核不包含 GPU/DRM 驱动模块（`virtio-gpu`、`drm`），导致 X server 找不到 `/dev/dri/card0` 和 `/dev/fb0`，无法启动。

### 诊断命令

```bash
# 检查当前内核
uname -r

# 检查 GPU 设备
ls /dev/dri/ /dev/fb*

# 检查 X server 日志
cat /var/log/Xorg.0.log | grep -E '(EE|Fatal)'

# 检查 slim 状态
systemctl status slim.service
```

### 修复步骤

1. 安装通用内核（如已安装可跳过）：

```bash
sudo apt-get install -y linux-image-arm64
```

2. 设置 GRUB 默认启动通用内核：

```bash
sudo sed -i 's/^GRUB_DEFAULT=.*/GRUB_DEFAULT=saved/' /etc/default/grub
# 替换下方 UUID 为实际值（通过 cat /boot/grub/grub.cfg | grep menuentry 查看）
sudo grub-set-default 'gnulinux-advanced-<UUID>>gnulinux-<VERSION>-arm64-advanced-<UUID>'
sudo update-grub
```

3. 在宿主机重启实例：

```bash
LIMA_HOME=/Users/hjr/Desktop/Kairo/.lima limactl stop kairo-vnc
LIMA_HOME=/Users/hjr/Desktop/Kairo/.lima limactl start --tty=false kairo-vnc
```

4. 验证修复：

```bash
LIMA_HOME=/Users/hjr/Desktop/Kairo/.lima limactl shell kairo-vnc -- bash -lc "uname -r; ls /dev/dri/; systemctl status slim.service --no-pager | head -5"
```

预期输出：内核为 `*-arm64`（非 `*-cloud-arm64`），`/dev/dri/card0` 存在，slim 状态为 `active (running)`。
