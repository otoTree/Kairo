#!/bin/bash
# Kairo OS 运行脚本（使用 bootloader 0.11）

set -e

# 加载 Rust 环境
export PATH="$HOME/.cargo/bin:$PATH"

echo "🔨 构建 Kairo OS 内核..."
cargo +nightly build --release \
    -Z build-std=core,compiler_builtins,alloc \
    -Z build-std-features=compiler-builtins-mem

KERNEL="target/x86_64-unknown-none/release/kairo-kernel"

if [ ! -f "$KERNEL" ]; then
    echo "❌ 内核文件不存在: $KERNEL"
    exit 1
fi

echo "✅ 内核构建成功！"
echo "📁 内核: $KERNEL ($(du -h $KERNEL | cut -f1))"
echo ""
echo "🚀 启动 QEMU（直接内核加载模式）..."
echo "💡 提示: 按 Ctrl+C 退出"
echo ""

# 使用 QEMU 直接内核加载功能（开发模式）
qemu-system-x86_64 \
    -kernel "$KERNEL" \
    -serial mon:stdio \
    -display cocoa \
    -m 512M \
    -no-reboot \
    -no-shutdown
