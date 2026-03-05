#!/bin/bash
# Kairo OS - 构建并运行脚本

set -e

echo "🔨 构建内核..."
cargo build --release -Z build-std=core,compiler_builtins,alloc -Z build-std-features=compiler-builtins-mem

KERNEL="target/x86_64-unknown-none/release/kairo-kernel"
OUTPUT="target/kairo-os.img"

if [ ! -f "$KERNEL" ]; then
    echo "❌ 内核文件不存在: $KERNEL"
    exit 1
fi

echo "✅ 内核构建成功！"
echo "📁 内核: $KERNEL ($(du -h $KERNEL | cut -f1))"

# 使用 dd 创建一个简单的磁盘镜像
echo ""
echo "🔧 创建引导镜像..."

# 创建 32MB 的镜像文件
dd if=/dev/zero of="$OUTPUT" bs=1M count=32 2>/dev/null

# 将内核写入镜像
dd if="$KERNEL" of="$OUTPUT" conv=notrunc 2>/dev/null

echo "✅ 引导镜像创建成功！"
echo "📁 镜像: $OUTPUT ($(du -h $OUTPUT | cut -f1))"

echo ""
echo "🚀 启动 QEMU..."
echo ""

# 运行 QEMU
qemu-system-x86_64 \
    -drive format=raw,file="$OUTPUT" \
    -serial mon:stdio \
    -display cocoa \
    -m 512M \
    -no-reboot \
    -no-shutdown
