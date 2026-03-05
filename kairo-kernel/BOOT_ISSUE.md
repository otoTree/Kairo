# ⚠️ 当前问题：无法引导

## 问题说明

QEMU 显示 "No bootable device" 是因为：

1. **bootloader 0.11 生成的是 ELF 文件**，不是传统的 BIOS 引导镜像
2. 简单的 `dd` 命令无法创建有效的引导扇区
3. bootloader 0.11 主要面向 UEFI，对 BIOS 支持有限

## 解决方案

### 🎯 推荐方案：回退到 bootloader 0.9

这是最快能看到效果的方法：

```bash
# 1. 安装兼容的 Rust 版本
rustup toolchain install nightly-2023-08-01
rustup default nightly-2023-08-01
rustup component add rust-src llvm-tools-preview

# 2. 修改 Cargo.toml
# 将 bootloader_api = "0.11" 改为 bootloader = "0.9"
# 将 x86_64 = "0.15" 改为 x86_64 = "0.14"

# 3. 修改 src/main.rs
# 使用 #[no_mangle] pub extern "C" fn _start()
# 而不是 entry_point! 宏

# 4. 构建并运行
cargo bootimage --release
qemu-system-x86_64 \
    -drive format=raw,file=target/x86_64-unknown-none/release/bootimage-kairo-kernel.bin \
    -serial mon:stdio \
    -display cocoa \
    -m 512M
```

### 🔧 替代方案：使用 UEFI

如果想继续使用 bootloader 0.11：

```bash
# 1. 安装 OVMF（UEFI 固件）
brew install ovmf

# 2. 创建 UEFI 引导盘（需要额外工具）
# 这比较复杂，需要创建 FAT32 分区和 EFI 目录结构

# 3. 运行
qemu-system-x86_64 \
    -bios /opt/homebrew/share/qemu/edk2-x86_64-code.fd \
    -drive format=raw,file=uefi-disk.img \
    -m 512M
```

## 我的建议

**立即可用**：回退到 bootloader 0.9
- ✅ 可以立即看到内核运行
- ✅ 工具链成熟稳定
- ❌ 需要使用旧版 Rust

**长期方案**：配置 UEFI 环境
- ✅ 使用现代工具链
- ✅ 面向未来
- ❌ 配置复杂

## 快速回退脚本

我可以帮你快速回退到 bootloader 0.9，只需要：
1. 修改几个文件
2. 切换 Rust 版本
3. 重新构建

要我帮你做吗？
