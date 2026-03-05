#!/usr/bin/env python3
"""
创建 Kairo OS 可引导镜像
使用 bootloader 0.11 API
"""

import subprocess
import sys
from pathlib import Path

def main():
    # 构建内核
    print("正在构建内核...")
    result = subprocess.run([
        "cargo", "build", "--release",
        "-Z", "build-std=core,compiler_builtins,alloc",
        "-Z", "build-std-features=compiler-builtins-mem"
    ])

    if result.returncode != 0:
        print("内核构建失败！")
        sys.exit(1)

    kernel_path = Path("target/x86_64-unknown-none/release/kairo-kernel")

    if not kernel_path.exists():
        print(f"错误：找不到内核文件 {kernel_path}")
        sys.exit(1)

    print(f"\n✅ 内核构建成功！")
    print(f"📁 内核文件: {kernel_path}")
    print(f"📊 文件大小: {kernel_path.stat().st_size / 1024:.2f} KB")
    print("\n要运行内核，请使用 QEMU 或创建 UEFI 引导盘。")

if __name__ == "__main__":
    main()
