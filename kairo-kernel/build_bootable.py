#!/usr/bin/env python3
"""
使用 bootloader 0.11 创建正确的 BIOS 引导镜像
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
        print(f"❌ 找不到内核文件: {kernel_path}")
        sys.exit(1)

    print(f"✅ 内核构建成功！")
    print(f"📁 内核: {kernel_path} ({kernel_path.stat().st_size / 1024:.2f} KB)")

    # 使用 Python 的 bootloader 库创建引导镜像
    print("\n🔧 创建 BIOS 引导镜像...")

    try:
        # 尝试导入并使用 bootloader Python 包
        sys.path.insert(0, str(Path.home() / ".cargo/registry/src"))

        # 手动创建引导镜像
        output_path = Path("target/kairo-bios.img")

        # 使用 Rust 的 bootloader 工具
        result = subprocess.run([
            "cargo", "run", "--package", "bootloader",
            "--", "build",
            "--kernel", str(kernel_path),
            "--output", str(output_path),
            "--bios"
        ], capture_output=True, text=True)

        if result.returncode == 0:
            print(f"✅ 引导镜像创建成功！")
            print(f"📁 镜像: {output_path}")
            print(f"\n🚀 运行命令:")
            print(f"qemu-system-x86_64 -drive format=raw,file={output_path} -serial mon:stdio -display cocoa -m 512M")
        else:
            raise Exception(result.stderr)

    except Exception as e:
        print(f"\n⚠️  无法自动创建引导镜像: {e}")
        print("\n📝 替代方案：")
        print("由于 bootloader 0.11 的限制，建议使用以下方法之一：")
        print("\n方案 1：使用 UEFI 模式运行（需要 OVMF）")
        print("  brew install ovmf")
        print(f"  qemu-system-x86_64 -bios /opt/homebrew/share/qemu/edk2-x86_64-code.fd -drive format=raw,file={kernel_path}")
        print("\n方案 2：回退到 bootloader 0.9（需要旧版 Rust）")
        print("  rustup default nightly-2023-08-01")
        print("  # 修改 Cargo.toml 使用 bootloader = \"0.9\"")
        print("  cargo bootimage --release")

if __name__ == "__main__":
    main()
