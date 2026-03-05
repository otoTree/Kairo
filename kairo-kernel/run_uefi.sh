#!/bin/bash
# Kairo OS - 创建 UEFI 引导盘并运行

set -e

echo "🔨 构建内核..."
cargo build --release -Z build-std=core,compiler_builtins,alloc -Z build-std-features=compiler-builtins-mem

KERNEL="target/x86_64-unknown-none/release/kairo-kernel"
ESP_IMG="target/kairo-uefi.img"
MOUNT_POINT="target/esp-mount"

if [ ! -f "$KERNEL" ]; then
    echo "❌ 内核文件不存在: $KERNEL"
    exit 1
fi

echo "✅ 内核构建成功！"
echo "📁 内核: $KERNEL ($(du -h $KERNEL | cut -f1))"

echo ""
echo "🔧 创建 UEFI 引导盘..."

# 创建 64MB 的磁盘镜像
dd if=/dev/zero of="$ESP_IMG" bs=1M count=64 2>/dev/null

# 创建 GPT 分区表和 EFI 系统分区
# 使用 fdisk 或 parted（macOS 上可能需要不同的工具）
echo "创建分区表..."

# 在 macOS 上，我们需要使用不同的方法
# 创建一个 FAT32 文件系统镜像
hdiutil create -size 64m -fs "MS-DOS FAT32" -volname "EFI" "$ESP_IMG.tmp" 2>/dev/null || {
    echo "⚠️  使用备用方法创建镜像..."
    # 备用方法：直接格式化为 FAT32
    mkfs.vfat -F 32 -n EFI "$ESP_IMG" 2>/dev/null || {
        echo "❌ 无法创建 FAT32 文件系统"
        echo "📝 需要安装 dosfstools: brew install dosfstools"
        exit 1
    }
}

# 如果使用了 hdiutil，转换格式
if [ -f "$ESP_IMG.tmp" ]; then
    hdiutil convert "$ESP_IMG.tmp" -format UDTO -o "$ESP_IMG"
    rm "$ESP_IMG.tmp"
fi

echo "✅ UEFI 引导盘创建成功！"
echo "📁 镜像: $ESP_IMG ($(du -h $ESP_IMG | cut -f1))"

echo ""
echo "🚀 启动 QEMU (UEFI 模式)..."
echo ""

# 使用 UEFI 固件运行
qemu-system-x86_64 \
    -bios /opt/homebrew/share/qemu/edk2-x86_64-code.fd \
    -drive format=raw,file="$ESP_IMG" \
    -kernel "$KERNEL" \
    -serial mon:stdio \
    -display cocoa \
    -m 512M \
    -no-reboot \
    -no-shutdown
