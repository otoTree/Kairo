#!/bin/bash
# Kairo OS - 构建并运行脚本

set -e

cd "$(dirname "$0")"

echo "🔨 构建 Kairo OS..."
cd xtask
export PATH="$HOME/.cargo/bin:$PATH"
cargo run --quiet

# 返回到 Kairo 目录
cd ..

echo ""
echo "🚀 启动 QEMU..."
echo "💡 提示: 按 Ctrl+C 退出"
echo ""

# 关闭可能存在的旧进程
pkill -f "qemu-system-x86_64.*kairo-os.img" 2>/dev/null || true
sleep 1

# 运行 QEMU
qemu-system-x86_64 \
    -drive format=raw,file=kairo-kernel/target/kairo-os.img \
    -serial mon:stdio \
    -display cocoa \
    -m 512M \
    -no-reboot \
    -no-shutdown
