#!/bin/sh
# deploy-vm.sh - 将编译好的二进制和配置部署到 Lima VM
# 在宿主机执行: ./scripts/deploy-vm.sh
set -eu

VM_NAME="${1:-kairo-river}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KAIRO_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$KAIRO_DIR/os/dist"

echo "=== Kairo River 部署脚本 ==="
echo "VM: $VM_NAME"

# 检查二进制是否存在
for bin in river kairo-wm kairo-kernel; do
  if [ ! -f "$DIST_DIR/$bin" ]; then
    echo "错误: $DIST_DIR/$bin 不存在"
    echo "请先执行: cd os && ./build_docker.sh && bun build --compile --target=bun-linux-arm64 src/index.ts --outfile os/dist/kairo-kernel"
    exit 1
  fi
done

# 通过 limactl copy 传输文件到 VM
echo "传输二进制文件..."
limactl copy "$DIST_DIR/river" "${VM_NAME}:/tmp/river"
limactl copy "$DIST_DIR/kairo-wm" "${VM_NAME}:/tmp/kairo-wm"
limactl copy "$DIST_DIR/kairo-kernel" "${VM_NAME}:/tmp/kairo-kernel"
limactl copy "$KAIRO_DIR/os/src/shell/config/init" "${VM_NAME}:/tmp/river-init"
limactl copy "$KAIRO_DIR/scripts/start-river.sh" "${VM_NAME}:/tmp/start-river"

# 传输桌面配置文件
echo "传输桌面配置..."
limactl copy "$KAIRO_DIR/configs/foot/foot.ini" "${VM_NAME}:/tmp/foot.ini"
limactl copy "$KAIRO_DIR/configs/waybar/config" "${VM_NAME}:/tmp/waybar-config"
limactl copy "$KAIRO_DIR/configs/waybar/style.css" "${VM_NAME}:/tmp/waybar-style.css"
limactl copy "$KAIRO_DIR/configs/fuzzel/fuzzel.ini" "${VM_NAME}:/tmp/fuzzel.ini"
limactl copy "$KAIRO_DIR/configs/gtk-3.0/settings.ini" "${VM_NAME}:/tmp/gtk-settings.ini"
limactl copy "$KAIRO_DIR/scripts/kairo-agent-status.sh" "${VM_NAME}:/tmp/kairo-agent-status"

# 在 VM 内安装
echo "安装到 VM..."
limactl shell "$VM_NAME" -- sh -c '
  sudo cp /tmp/river /usr/local/bin/river
  sudo cp /tmp/kairo-wm /usr/local/bin/kairo-wm
  sudo cp /tmp/kairo-kernel /usr/local/bin/kairo-kernel
  sudo chmod +x /usr/local/bin/river /usr/local/bin/kairo-wm /usr/local/bin/kairo-kernel

  mkdir -p "$HOME/.config/river"
  cp /tmp/river-init "$HOME/.config/river/init"
  chmod +x "$HOME/.config/river/init"

  sudo cp /tmp/start-river /usr/local/bin/start-river
  sudo chmod +x /usr/local/bin/start-river

  # 部署桌面配置文件
  mkdir -p "$HOME/.config/foot" "$HOME/.config/waybar" "$HOME/.config/fuzzel" "$HOME/.config/gtk-3.0"
  cp /tmp/foot.ini "$HOME/.config/foot/foot.ini"
  cp /tmp/waybar-config "$HOME/.config/waybar/config"
  cp /tmp/waybar-style.css "$HOME/.config/waybar/style.css"
  cp /tmp/fuzzel.ini "$HOME/.config/fuzzel/fuzzel.ini"
  cp /tmp/gtk-settings.ini "$HOME/.config/gtk-3.0/settings.ini"

  # 部署 Agent 状态脚本
  sudo cp /tmp/kairo-agent-status /usr/local/bin/kairo-agent-status
  sudo chmod +x /usr/local/bin/kairo-agent-status

  # 清理临时文件
  rm -f /tmp/river /tmp/kairo-wm /tmp/kairo-kernel /tmp/river-init /tmp/start-river
  rm -f /tmp/foot.ini /tmp/waybar-config /tmp/waybar-style.css /tmp/fuzzel.ini /tmp/gtk-settings.ini /tmp/kairo-agent-status

  echo ""
  echo "=== 验证 ==="
  echo "river:        $(which river 2>/dev/null || echo 未找到)"
  echo "kairo-wm:     $(which kairo-wm 2>/dev/null || echo 未找到)"
  echo "kairo-kernel: $(which kairo-kernel 2>/dev/null || echo 未找到)"
  echo "foot:         $(which foot 2>/dev/null || echo 未找到)"
  echo "waybar:       $(which waybar 2>/dev/null || echo 未找到)"
  echo "swaybg:       $(which swaybg 2>/dev/null || echo 未找到)"
  echo "fuzzel:       $(which fuzzel 2>/dev/null || echo 未找到)"
  echo "init:         $HOME/.config/river/init"
'

echo ""
echo "部署完成! 执行: limactl shell $VM_NAME -- start-river"
