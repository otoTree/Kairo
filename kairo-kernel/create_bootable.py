#!/usr/bin/env python3
"""
创建 Kairo OS 可引导 BIOS 镜像
使用 bootloader 0.11 API
"""

import subprocess
import sys
from pathlib import Path

def main():
    print("🔨 构建 Kairo OS 内核...")

    # 构建内核
    result = subprocess.run([
        "cargo", "build", "--release",
        "-Z", "build-std=core,compiler_builtins,alloc",
        "-Z", "build-std-features=compiler-builtins-mem"
    ])

    if result.returncode != 0:
        print("❌ 内核构建失败！")
        sys.exit(1)

    kernel_path = Path("target/x86_64-unknown-none/release/kairo-kernel")

    if not kernel_path.exists():
        print(f"❌ 错误：找不到内核文件 {kernel_path}")
        sys.exit(1)

    print(f"✅ 内核构建成功！")
    print(f"📁 内核文件: {kernel_path}")
    print(f"📊 文件大小: {kernel_path.stat().st_size / 1024:.2f} KB")

    # 使用 bootloader crate 创建 BIOS 引导镜像
    print("\n🔧 创建 BIOS 引导镜像...")

    try:
        import bootloader

        # 创建引导镜像
        output_path = Path("target/kairo-os.img")
        bootloader.create_disk_image(
            kernel_path=str(kernel_path),
            output_path=str(output_path),
            bios=True
        )

        print(f"✅ 引导镜像创建成功！")
        print(f"📁 镜像文件: {output_path}")
        print(f"📊 文件大小: {output_path.stat().st_size / 1024 / 1024:.2f} MB")

        print("\n🚀 运行命令:")
        print(f"qemu-system-x86_64 -drive format=raw,file={output_path} -serial mon:stdio -display cocoa -m 512M")

    except ImportError:
        print("\n⚠️  Python bootloader 模块未安装")
        print("📝 手动创建引导镜像的步骤:")
        print("1. 安装 bootloader 工具: cargo install bootloader")
        print(f"2. 创建镜像: bootloader build --kernel {kernel_path} --output target/kairo-os.img")
        print("3. 运行: qemu-system-x86_64 -drive format=raw,file=target/kairo-os.img -serial mon:stdio")

if __name__ == "__main__":
    main()
