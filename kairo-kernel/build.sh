#!/bin/bash
# Kairo OS 构建脚本（使用 bootloader 0.11）

set -e

echo "构建 Kairo OS 内核..."
cargo build --release -Z build-std=core,compiler_builtins,alloc -Z build-std-features=compiler-builtins-mem

echo ""
echo "内核构建成功！"
echo "内核文件: target/x86_64-unknown-none/release/kairo-kernel"
echo ""
echo "要运行内核，需要使用 UEFI 或创建引导镜像。"
echo ""
echo "使用 QEMU UEFI 运行（推荐）："
echo "  qemu-system-x86_64 -bios /path/to/OVMF.fd -drive format=raw,file=target/x86_64-unknown-none/release/kairo-kernel"
