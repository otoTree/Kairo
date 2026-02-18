#!/bin/sh
# deploy-vm.sh - 将编译好的二进制和配置部署到 VM 内
# 在 Lima VM 内执行: ~/Desktop/Kairo/scripts/deploy-vm.sh
set -eu

KAIRO_DIR="$HOME/Desktop/Kairo"
DIST_DIR="$KAIRO_DIR/os/dist"

echo "=== Kairo River 部署脚本 ==="

# 检查二进制是否存在
for bin in river kairo-wm init; do
  if [ ! -f "$DIST_DIR/$bin" ]; then
    echo "错误: $DIST_DIR/$bin 不存在"
    echo "请先在宿主机执行: cd os && ./build_docker.sh"
    exit 1
  fi
done

# 安装二进制
echo "安装二进制文件..."
sudo cp "$DIST_DIR/river" /usr/local/bin/river
sudo cp "$DIST_DIR/kairo-wm" /usr/local/bin/kairo-wm
sudo chmod +x /usr/local/bin/river /usr/local/bin/kairo-wm

# 部署 River init 配置
echo "部署 River init 配置..."
mkdir -p "$HOME/.config/river"
cp "$KAIRO_DIR/os/src/shell/config/init" "$HOME/.config/river/init"
chmod +x "$HOME/.config/river/init"

# 部署 River 启动脚本
echo "部署启动脚本..."
sudo cp "$KAIRO_DIR/scripts/start-river.sh" /usr/local/bin/start-river
sudo chmod +x /usr/local/bin/start-river

# 验证
echo ""
echo "=== 验证 ==="
echo "river:    $(which river 2>/dev/null || echo '未找到')"
echo "kairo-wm: $(which kairo-wm 2>/dev/null || echo '未找到')"
echo "foot:     $(which foot 2>/dev/null || echo '未找到')"
echo "init:     $HOME/.config/river/init"
echo ""
echo "部署完成! 执行 start-river 启动 River compositor"
