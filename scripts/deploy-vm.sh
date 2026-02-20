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
for bin in river kairo-wm; do
  if [ ! -f "$DIST_DIR/$bin" ]; then
    echo "错误: $DIST_DIR/$bin 不存在"
    echo "请先执行: cd os && ./build_docker.sh"
    exit 1
  fi
done

# 通过 limactl copy 传输文件到 VM
echo "传输二进制文件..."
limactl copy "$DIST_DIR/river" "${VM_NAME}:/tmp/river"
limactl copy "$DIST_DIR/kairo-wm" "${VM_NAME}:/tmp/kairo-wm"
limactl copy "$KAIRO_DIR/os/src/shell/config/init" "${VM_NAME}:/tmp/river-init"
limactl copy "$KAIRO_DIR/scripts/start-river.sh" "${VM_NAME}:/tmp/start-river"

# 在 VM 内安装
echo "安装到 VM..."
limactl shell "$VM_NAME" -- sh -c '
  sudo cp /tmp/river /usr/local/bin/river
  sudo cp /tmp/kairo-wm /usr/local/bin/kairo-wm
  sudo chmod +x /usr/local/bin/river /usr/local/bin/kairo-wm

  mkdir -p "$HOME/.config/river"
  cp /tmp/river-init "$HOME/.config/river/init"
  chmod +x "$HOME/.config/river/init"

  sudo cp /tmp/start-river /usr/local/bin/start-river
  sudo chmod +x /usr/local/bin/start-river

  rm -f /tmp/river /tmp/kairo-wm /tmp/river-init /tmp/start-river

  echo ""
  echo "=== 验证 ==="
  echo "river:    $(which river 2>/dev/null || echo 未找到)"
  echo "kairo-wm: $(which kairo-wm 2>/dev/null || echo 未找到)"
  echo "foot:     $(which foot 2>/dev/null || echo 未找到)"
  echo "init:     $HOME/.config/river/init"
'

echo ""
echo "部署完成! 执行: limactl shell $VM_NAME -- start-river"
