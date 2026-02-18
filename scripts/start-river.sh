#!/bin/sh
# start-river.sh - 在 VM 内启动 River Wayland Compositor
# 需要从 TTY 或 SSH 执行 (不能在已有的 Wayland/X11 会话内)
set -eu

# 确保 seatd 运行
if ! rc-service seatd status >/dev/null 2>&1; then
  echo "启动 seatd..."
  sudo rc-service seatd start
fi

# 环境变量
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-$(id -u)}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"

# wlroots 渲染配置 (VM 内用软件渲染)
export WLR_RENDERER=pixman
export WLR_NO_HARDWARE_CURSORS=1

# QEMU 虚拟 GPU 的 DRM 设备
if [ -e /dev/dri/card0 ]; then
  export WLR_DRM_DEVICES=/dev/dri/card0
fi

# 日志级别
export RIVER_LOG_LEVEL="${RIVER_LOG_LEVEL:-debug}"

echo "=== 启动 Kairo River ==="
echo "XDG_RUNTIME_DIR: $XDG_RUNTIME_DIR"
echo "WLR_RENDERER:    $WLR_RENDERER"
echo "River init:      $HOME/.config/river/init"
echo ""

exec river -log-level debug
