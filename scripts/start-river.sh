#!/bin/sh
# start-river.sh - 在 VM 内启动 River Wayland Compositor
# 需要从 TTY 或 SSH 执行 (不能在已有的 Wayland/X11 会话内)
set -eu

# seat 管理：停止系统 seatd，改用 seatd-launch 为当前会话分配 seat
# （SSH 会话无法从系统 seatd 获取 seat）
if rc-service seatd status >/dev/null 2>&1; then
  echo "停止系统 seatd（改用 seatd-launch）..."
  sudo rc-service seatd stop
  sleep 0.5
fi

# 确保 udev-trigger 已运行（libinput 依赖 udev 属性识别输入设备）
if ! rc-service udev-trigger status >/dev/null 2>&1; then
  echo "启动 udev-trigger..."
  sudo rc-service udev-trigger start
fi

# 环境变量
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-$(id -u)}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"

# wlroots 渲染配置 (VM 内用软件渲染)
export WLR_RENDERER=pixman
export WLR_NO_HARDWARE_CURSORS=1
export WLR_LIBINPUT_NO_DEVICES=1

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

# 通过 seatd-launch 启动（SSH 会话需要独立 seat 分配）
if command -v seatd-launch >/dev/null 2>&1; then
  exec seatd-launch -- river -log-level debug
else
  exec river -log-level debug
fi
