#!/bin/sh
# deploy-vm.sh - 将编译好的二进制和配置部署到 Lima VM
# 在宿主机执行: ./scripts/deploy-vm.sh
set -eu

VM_NAME="${1:-kairo-river}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KAIRO_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$KAIRO_DIR/os/dist"
ENV_TMP=""

echo "=== Kairo River 部署脚本 ==="
echo "VM: $VM_NAME"

# 检查二进制是否存在
for bin in river kairo-wm kairo-kernel kairo-brand kairo-agent-ui; do
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
limactl copy "$DIST_DIR/kairo-kernel" "${VM_NAME}:/tmp/kairo-kernel"
limactl copy "$DIST_DIR/kairo-brand" "${VM_NAME}:/tmp/kairo-brand"
limactl copy "$DIST_DIR/kairo-agent-ui" "${VM_NAME}:/tmp/kairo-agent-ui"
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

# 可选：同步宿主机 .env 的 AI/服务配置（仅白名单键）
if [ -f "$KAIRO_DIR/.env" ]; then
  ENV_TMP="$(mktemp)"
  awk -F= '/^(OPENAI_|OLLAMA_|KAIRO_TOKEN|PORT)/ {print $0}' "$KAIRO_DIR/.env" > "$ENV_TMP"
  if [ -s "$ENV_TMP" ]; then
    echo "同步 .env（OPENAI_/OLLAMA_/KAIRO_TOKEN/PORT）..."
    limactl copy "$ENV_TMP" "${VM_NAME}:/tmp/kairo.env"
  fi
fi

# 在 VM 内安装
echo "安装到 VM..."
limactl shell "$VM_NAME" -- sh -c '
  sudo cp /tmp/river /usr/local/bin/river
  sudo cp /tmp/kairo-wm /usr/local/bin/kairo-wm
  sudo cp /tmp/kairo-kernel /usr/local/bin/kairo-kernel
  sudo cp /tmp/kairo-brand /usr/local/bin/kairo-brand
  sudo cp /tmp/kairo-agent-ui /usr/local/bin/kairo-agent-ui
  sudo chmod +x /usr/local/bin/river /usr/local/bin/kairo-wm /usr/local/bin/kairo-kernel /usr/local/bin/kairo-brand /usr/local/bin/kairo-agent-ui

  mkdir -p "$HOME/.config/river"
  cp /tmp/river-init "$HOME/.config/river/init"
  chmod +x "$HOME/.config/river/init"

  sudo cp /tmp/start-river /usr/local/bin/start-river
  sudo chmod +x /usr/local/bin/start-river

  if [ -f /tmp/kairo.env ]; then
    mkdir -p "$HOME/.config/kairo"
    cp /tmp/kairo.env "$HOME/.config/kairo/kairo.env"
    chmod 600 "$HOME/.config/kairo/kairo.env"
  fi

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

  # 创建 .desktop 文件（让 fuzzel 能发现原生应用）
  sudo tee /usr/share/applications/kairo-brand.desktop > /dev/null << DEOF
[Desktop Entry]
Name=Kairo
Comment=Kairo Brand Window
Exec=kairo-brand
Type=Application
Categories=System;
DEOF
  sudo tee /usr/share/applications/kairo-agent.desktop > /dev/null << DEOF
[Desktop Entry]
Name=Kairo Agent
Comment=Kairo Agent UI
Exec=kairo-agent-ui
Type=Application
Categories=System;
DEOF

  # Thunar 需要 D-Bus session bus，创建 wrapper 脚本
  sudo tee /usr/local/bin/thunar-wrapper > /dev/null << "DEOF"
#!/bin/sh
exec dbus-run-session -- thunar "$@"
DEOF
  sudo chmod +x /usr/local/bin/thunar-wrapper
  # 修改 thunar .desktop 使用 wrapper
  if [ -f /usr/share/applications/thunar.desktop ]; then
    sudo sed -i "s|^Exec=thunar |Exec=thunar-wrapper |g" /usr/share/applications/thunar.desktop
  fi

  # 清理临时文件
  rm -f /tmp/river /tmp/kairo-wm /tmp/kairo-kernel /tmp/kairo-brand /tmp/kairo-agent-ui /tmp/river-init /tmp/start-river
  rm -f /tmp/foot.ini /tmp/waybar-config /tmp/waybar-style.css /tmp/fuzzel.ini /tmp/gtk-settings.ini /tmp/kairo-agent-status
  rm -f /tmp/kairo.env

  echo ""
  echo "=== 验证 ==="
  echo "river:        $(which river 2>/dev/null || echo 未找到)"
  echo "kairo-wm:     $(which kairo-wm 2>/dev/null || echo 未找到)"
  echo "kairo-kernel: $(which kairo-kernel 2>/dev/null || echo 未找到)"
  echo "kairo-brand:  $(which kairo-brand 2>/dev/null || echo 未找到)"
  echo "kairo-agent:  $(which kairo-agent-ui 2>/dev/null || echo 未找到)"
  echo "foot:         $(which foot 2>/dev/null || echo 未找到)"
  echo "waybar:       $(which waybar 2>/dev/null || echo 未找到)"
  echo "swaybg:       $(which swaybg 2>/dev/null || echo 未找到)"
  echo "fuzzel:       $(which fuzzel 2>/dev/null || echo 未找到)"
  echo "init:         $HOME/.config/river/init"
'

if [ -n "$ENV_TMP" ]; then
  rm -f "$ENV_TMP"
fi

echo ""
echo "部署完成! 执行: limactl shell $VM_NAME -- start-river"
