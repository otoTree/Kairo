# Kairo OS 内核

基于 Rust 的操作系统内核，目标是支持运行 Linux 程序的全新 OS。

## 项目状态

当前版本：v0.1.0 - 最小可引导内核（使用 bootloader 0.11）

已实现功能：
- ✅ 裸机引导（no_std）
- ✅ Framebuffer 图形输出（1280x720，BGR 格式）
- ✅ 串口调试输出
- ✅ 基本图形绘制
- ✅ Panic 处理器
- ✅ x86_64 架构支持
- ✅ 使用现代 bootloader API
- ✅ BIOS 引导镜像生成

## 快速开始

### 环境要求

- Rust nightly (最新版本)
- QEMU（用于测试）

### 构建和运行

**推荐方式**：使用根目录的便捷脚本

```bash
cd /Users/hjr/Desktop/Kairo
./run-kairo.sh
```

这个脚本会：
1. 自动构建内核
2. 使用 xtask 工具创建 BIOS 引导镜像
3. 启动 QEMU 并显示串口输出

**手动方式**：

```bash
# 1. 构建内核和引导镜像
cd xtask
cargo run

# 2. 运行 QEMU
cd ..
qemu-system-x86_64 \
    -drive format=raw,file=kairo-kernel/target/kairo-os.img \
    -serial mon:stdio \
    -display cocoa \
    -m 512M \
    -no-reboot \
    -no-shutdown
```

## 项目结构

```
kairo-kernel/
├── Cargo.toml              # 项目配置
├── .cargo/
│   └── config.toml         # 构建配置
├── src/
│   ├── main.rs             # 内核入口点
│   ├── vga_buffer.rs       # VGA 缓冲区驱动（暂未使用）
│   ├── serial.rs           # 串口输出驱动
│   └── boot_config.rs      # Bootloader 配置
├── build.rs                # 构建脚本
└── README.md               # 本文件
```

## 技术栈

- **语言**: Rust (nightly)
- **架构**: x86_64
- **引导**: bootloader_api 0.11
- **目标**: x86_64-unknown-none (裸机)

## 重要说明

### bootloader 0.11 vs 0.9

- **0.9**: 生成传统 BIOS 引导镜像，但与现代 Rust 不兼容
- **0.11**: 现代 API，与最新 Rust 兼容，但需要 UEFI 环境

当前项目使用 0.11 以确保与最新 Rust 工具链的兼容性。

### 下一步计划

- [ ] 位图字体渲染系统
- [ ] 基于 Framebuffer 的文本输出
- [ ] 中断处理（IDT、APIC）
- [ ] 内存管理（分页、堆分配器）
- [ ] 进程管理（fork/exec）
- [ ] 系统调用接口
- [ ] ELF 加载器
- [ ] Linux 兼容层

## 参考资源

- [Rust OS 架构设计文档](../docs/rust-os-design/rust-os-architecture.md)
- [QEMU 开发指南](../docs/rust-os-design/qemu-development-guide.md)
- [Writing an OS in Rust](https://os.phil-opp.com/)
- [bootloader_api 文档](https://docs.rs/bootloader_api/)

## 许可证

MIT License
