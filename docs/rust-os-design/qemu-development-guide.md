# QEMU 开发与调试指南（macOS 优化版）

> **注意**：本指南针对 macOS 开发环境进行了优化，包含 Hypervisor.framework 加速、LLDB 调试等 macOS 特定配置。

## 快速开始（macOS）

```bash
# 1. 安装依赖
brew install qemu
xcode-select --install

# 2. 安装 Rust 工具链
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install nightly
rustup default nightly
rustup component add rust-src llvm-tools-preview

# 3. 安装 bootimage
cargo install bootimage

# 4. 创建项目
cargo new --bin kairo-kernel
cd kairo-kernel

# 5. 构建并运行
cargo bootimage
qemu-system-x86_64 \
    -drive format=raw,file=target/x86_64-kairo/release/bootimage-kairo-kernel.bin \
    -accel hvf \
    -m 512M \
    -serial mon:stdio \
    -display cocoa
```

---

## 1. QEMU 环境搭建

### 1.1 安装 QEMU（macOS 优化）

```bash
# macOS（推荐使用 Homebrew）
brew install qemu

# 验证安装
qemu-system-x86_64 --version

# 检查可用的加速器
qemu-system-x86_64 -accel help
# 输出应包含：hvf (Hypervisor.framework)

# Ubuntu/Debian（参考）
sudo apt install qemu-system-x86 qemu-system-aarch64

# Arch Linux（参考）
sudo pacman -S qemu qemu-arch-extra
```

**macOS 特别说明**：
- macOS 不支持 KVM，但可以使用 **Hypervisor.framework (hvf)** 加速
- hvf 性能接近 KVM，但仅支持 x86_64 架构
- 使用 `-accel hvf` 参数启用硬件加速

### 1.2 安装必要工具（macOS）

```bash
# 安装 Rust nightly（内核开发必需）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install nightly
rustup default nightly
rustup component add rust-src llvm-tools-preview

# 安装 bootimage（用于创建可引导镜像）
cargo install bootimage

# 安装 cargo-xbuild（交叉编译）
cargo install cargo-xbuild

# 安装 LLDB（macOS 上的调试器，替代 GDB）
# 通常随 Xcode Command Line Tools 一起安装
xcode-select --install

# 可选：安装 GDB（需要代码签名）
brew install gdb
# 注意：macOS 上的 GDB 需要特殊配置，见下文
```

**macOS GDB 配置**：

由于 macOS 的安全限制，GDB 需要代码签名才能调试程序。

```bash
# 1. 创建代码签名证书
# 打开"钥匙串访问" -> 证书助理 -> 创建证书
# 名称：gdb-cert
# 身份类型：自签名根证书
# 证书类型：代码签名

# 2. 信任证书
# 在"钥匙串访问"中找到 gdb-cert，右键 -> 显示简介 -> 信任 -> 代码签名：始终信任

# 3. 签名 GDB
codesign -fs gdb-cert $(which gdb)

# 4. 重启 taskgated
sudo killall taskgated

# 5. 验证
gdb --version
```

**推荐：使用 LLDB 替代 GDB**

macOS 上推荐使用 LLDB，它是 Xcode 的默认调试器，无需额外配置：

```bash
# 使用 rust-lldb（Rust 优化版）
rustup component add lldb-preview

# 或直接使用系统 LLDB
lldb --version
```

---

## 2. 最小可引导内核

### 2.1 项目结构

```
kairo-kernel/
├── Cargo.toml
├── .cargo/
│   └── config.toml
├── src/
│   ├── main.rs
│   └── vga_buffer.rs
├── x86_64-kairo.json       # 自定义目标配置
└── boot/
    └── grub.cfg
```

### 2.2 Cargo.toml

```toml
[package]
name = "kairo-kernel"
version = "0.1.0"
edition = "2021"

[profile.dev]
panic = "abort"

[profile.release]
panic = "abort"

[dependencies]
bootloader = "0.11"
x86_64 = "0.15"
spin = "0.9"
uart_16550 = "0.3"
pic8259 = "0.11"

[dependencies.lazy_static]
version = "1.4"
features = ["spin_no_std"]
```

### 2.3 .cargo/config.toml

```toml
[build]
target = "x86_64-kairo.json"

[target.'cfg(target_os = "none")']
runner = "bootimage runner"

[unstable]
build-std = ["core", "compiler_builtins", "alloc"]
build-std-features = ["compiler-builtins-mem"]
```

### 2.4 自定义目标配置 (x86_64-kairo.json)

```json
{
  "llvm-target": "x86_64-unknown-none",
  "data-layout": "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-f80:128-n8:16:32:64-S128",
  "arch": "x86_64",
  "target-endian": "little",
  "target-pointer-width": "64",
  "target-c-int-width": "32",
  "os": "none",
  "executables": true,
  "linker-flavor": "ld.lld",
  "linker": "rust-lld",
  "panic-strategy": "abort",
  "disable-redzone": true,
  "features": "-mmx,-sse,+soft-float"
}
```

### 2.5 最小内核代码 (src/main.rs)

```rust
#![no_std]
#![no_main]
#![feature(custom_test_frameworks)]
#![test_runner(crate::test_runner)]
#![reexport_test_harness_main = "test_main"]

use core::panic::PanicInfo;

mod vga_buffer;

/// 内核入口点
#[no_mangle]
pub extern "C" fn _start() -> ! {
    println!("Kairo OS v0.1.0");
    println!("Booting in QEMU...");

    #[cfg(test)]
    test_main();

    println!("Kernel initialized successfully!");

    // 进入空闲循环
    loop {
        x86_64::instructions::hlt();
    }
}

/// Panic 处理器
#[panic_handler]
fn panic(info: &PanicInfo) -> ! {
    println!("{}", info);
    loop {
        x86_64::instructions::hlt();
    }
}

#[cfg(test)]
fn test_runner(tests: &[&dyn Fn()]) {
    println!("Running {} tests", tests.len());
    for test in tests {
        test();
    }
}
```

### 2.6 VGA 文本模式输出 (src/vga_buffer.rs)

```rust
use core::fmt;
use spin::Mutex;
use lazy_static::lazy_static;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Color {
    Black = 0,
    Blue = 1,
    Green = 2,
    Cyan = 3,
    Red = 4,
    Magenta = 5,
    Brown = 6,
    LightGray = 7,
    DarkGray = 8,
    LightBlue = 9,
    LightGreen = 10,
    LightCyan = 11,
    LightRed = 12,
    Pink = 13,
    Yellow = 14,
    White = 15,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
struct ColorCode(u8);

impl ColorCode {
    fn new(foreground: Color, background: Color) -> ColorCode {
        ColorCode((background as u8) << 4 | (foreground as u8))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(C)]
struct ScreenChar {
    ascii_character: u8,
    color_code: ColorCode,
}

const BUFFER_HEIGHT: usize = 25;
const BUFFER_WIDTH: usize = 80;

#[repr(transparent)]
struct Buffer {
    chars: [[ScreenChar; BUFFER_WIDTH]; BUFFER_HEIGHT],
}

pub struct Writer {
    column_position: usize,
    color_code: ColorCode,
    buffer: &'static mut Buffer,
}

impl Writer {
    pub fn write_byte(&mut self, byte: u8) {
        match byte {
            b'\n' => self.new_line(),
            byte => {
                if self.column_position >= BUFFER_WIDTH {
                    self.new_line();
                }

                let row = BUFFER_HEIGHT - 1;
                let col = self.column_position;

                let color_code = self.color_code;
                self.buffer.chars[row][col] = ScreenChar {
                    ascii_character: byte,
                    color_code,
                };
                self.column_position += 1;
            }
        }
    }

    pub fn write_string(&mut self, s: &str) {
        for byte in s.bytes() {
            match byte {
                0x20..=0x7e | b'\n' => self.write_byte(byte),
                _ => self.write_byte(0xfe),
            }
        }
    }

    fn new_line(&mut self) {
        for row in 1..BUFFER_HEIGHT {
            for col in 0..BUFFER_WIDTH {
                let character = self.buffer.chars[row][col];
                self.buffer.chars[row - 1][col] = character;
            }
        }
        self.clear_row(BUFFER_HEIGHT - 1);
        self.column_position = 0;
    }

    fn clear_row(&mut self, row: usize) {
        let blank = ScreenChar {
            ascii_character: b' ',
            color_code: self.color_code,
        };
        for col in 0..BUFFER_WIDTH {
            self.buffer.chars[row][col] = blank;
        }
    }
}

impl fmt::Write for Writer {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.write_string(s);
        Ok(())
    }
}

lazy_static! {
    pub static ref WRITER: Mutex<Writer> = Mutex::new(Writer {
        column_position: 0,
        color_code: ColorCode::new(Color::Yellow, Color::Black),
        buffer: unsafe { &mut *(0xb8000 as *mut Buffer) },
    });
}

#[macro_export]
macro_rules! print {
    ($($arg:tt)*) => ($crate::vga_buffer::_print(format_args!($($arg)*)));
}

#[macro_export]
macro_rules! println {
    () => ($crate::print!("\n"));
    ($($arg:tt)*) => ($crate::print!("{}\n", format_args!($($arg)*)));
}

#[doc(hidden)]
pub fn _print(args: fmt::Arguments) {
    use core::fmt::Write;
    WRITER.lock().write_fmt(args).unwrap();
}
```

---

## 3. QEMU 运行配置

### 3.1 基础运行脚本 (run.sh)

```bash
#!/bin/bash

# 构建内核
cargo bootimage --release

# 运行 QEMU
qemu-system-x86_64 \
    -drive format=raw,file=target/x86_64-kairo/release/bootimage-kairo-kernel.bin \
    -serial mon:stdio \
    -display gtk \
    -m 512M \
    -smp 2 \
    -cpu qemu64 \
    -no-reboot \
    -no-shutdown
```

### 3.2 高级 QEMU 配置（macOS 优化）

```bash
#!/bin/bash
# run-advanced-macos.sh

KERNEL_IMAGE="target/x86_64-kairo/release/bootimage-kairo-kernel.bin"

qemu-system-x86_64 \
    # 内核镜像
    -drive format=raw,file=$KERNEL_IMAGE \
    \
    # 内存配置
    -m 2G \
    \
    # CPU 配置（macOS 使用 hvf 加速）
    -smp cores=4,threads=1,sockets=1 \
    -cpu host \
    -accel hvf \
    \
    # 显示配置
    -display cocoa \
    -vga virtio \
    \
    # 串口输出（用于日志）
    -serial mon:stdio \
    \
    # 网络配置（用户模式网络）
    -netdev user,id=net0,hostfwd=tcp::8080-:80 \
    -device e1000,netdev=net0 \
    \
    # 存储配置
    -drive file=disk.img,if=virtio,format=qcow2 \
    \
    # 调试配置
    -gdb tcp::1234 \
    -S \
    \
    # 其他选项
    -no-reboot \
    -no-shutdown \
    -d int,cpu_reset \
    -D qemu.log
```

**macOS 特定参数说明**：

| 参数 | macOS 说明 |
|------|-----------|
| `-accel hvf` | 使用 Hypervisor.framework 加速（替代 Linux 的 KVM） |
| `-display cocoa` | 使用 macOS 原生 Cocoa 界面（比 GTK 更流畅） |
| `-cpu host` | 使用宿主机 CPU 特性（需要 hvf） |
| `-smp 4` | 模拟 4 核 CPU（建议不超过物理核心数） |

### 3.3 QEMU 参数说明

| 参数 | 说明 |
|------|------|
| `-m 2G` | 分配 2GB 内存 |
| `-smp 4` | 模拟 4 核 CPU |
| `-cpu host` | 使用宿主机 CPU 特性 |
| `-enable-kvm` | 启用 KVM 硬件加速（Linux/macOS） |
| `-serial mon:stdio` | 串口输出到标准输出 |
| `-display gtk` | 使用 GTK 图形界面 |
| `-vga virtio` | 使用 VirtIO GPU |
| `-netdev user` | 用户模式网络（NAT） |
| `-gdb tcp::1234` | 启用 GDB 远程调试 |
| `-S` | 启动时暂停，等待 GDB 连接 |
| `-d int,cpu_reset` | 启用调试日志 |
| `-no-reboot` | 崩溃时不重启 |

---

## 4. 调试配置（macOS）

### 4.1 使用 LLDB 调试（推荐）

```bash
# 终端 1：启动 QEMU（带调试选项）
qemu-system-x86_64 \
    -drive format=raw,file=target/x86_64-kairo/release/bootimage-kairo-kernel.bin \
    -accel hvf \
    -m 512M \
    -serial mon:stdio \
    -gdb tcp::1234 \
    -S

# 终端 2：启动 LLDB
lldb target/x86_64-kairo/release/kairo-kernel

# LLDB 命令
(lldb) gdb-remote localhost:1234
(lldb) breakpoint set --name _start
(lldb) continue
```

### 4.2 LLDB 常用命令

```lldb
# 连接到 QEMU
gdb-remote localhost:1234

# 设置断点
breakpoint set --name _start
breakpoint set --name panic
breakpoint set --address 0x100000

# 查看寄存器
register read
register read rax rbx rcx

# 查看内存
memory read 0xb8000
memory read --size 4 --format x --count 16 0xb8000

# 单步执行
stepi  # 单步执行一条指令
nexti  # 单步执行（跳过函数调用）

# 查看调用栈
bt  # backtrace

# 查看变量
frame variable
print variable_name

# 反汇编
disassemble --name _start
disassemble --start-address 0x100000 --count 20

# 继续执行
continue
```

### 4.3 LLDB 配置文件 (.lldbinit)

在项目根目录创建 `.lldbinit`：

```lldb
# 连接到 QEMU
gdb-remote localhost:1234

# 设置架构
settings set target.arch x86_64

# 加载符号
target create target/x86_64-kairo/release/kairo-kernel

# 常用断点
breakpoint set --name _start
breakpoint set --name panic

# 自动继续执行
continue
```

### 4.4 使用 GDB 调试（可选）

如果你已经配置好 GDB 代码签名：

```bash
# 终端 1：启动 QEMU
./run-debug.sh

# 终端 2：启动 GDB
rust-gdb target/x86_64-kairo/release/kairo-kernel

# GDB 命令
(gdb) target remote :1234
(gdb) break _start
(gdb) continue
```

### 4.2 GDB 配置文件 (.gdbinit)

```gdb
# 连接到 QEMU
target remote :1234

# 设置架构
set architecture i386:x86-64

# 加载符号
symbol-file target/x86_64-kairo/release/kairo-kernel

# 常用断点
break _start
break panic

# 显示汇编
layout asm
layout regs

# 自动继续执行
continue
```

### 4.3 常用 GDB 命令

```gdb
# 查看寄存器
info registers

# 查看内存
x/10x 0xb8000  # 查看 VGA 缓冲区

# 单步执行
stepi  # 单步执行一条指令
nexti  # 单步执行（跳过函数调用）

# 查看调用栈
backtrace

# 查看变量
print variable_name

# 设置断点
break function_name
break *0x100000  # 在地址处设置断点

# 查看源代码
list
```

---

## 5. 测试框架

### 5.1 集成测试

```rust
// tests/basic_boot.rs
#![no_std]
#![no_main]
#![feature(custom_test_frameworks)]
#![test_runner(kairo_kernel::test_runner)]
#![reexport_test_harness_main = "test_main"]

use core::panic::PanicInfo;
use kairo_kernel::println;

#[no_mangle]
pub extern "C" fn _start() -> ! {
    test_main();

    loop {}
}

#[panic_handler]
fn panic(info: &PanicInfo) -> ! {
    kairo_kernel::test_panic_handler(info)
}

#[test_case]
fn test_println() {
    println!("test_println output");
}
```

### 5.2 运行测试

```bash
# 运行所有测试
cargo test

# 运行特定测试
cargo test --test basic_boot

# 在 QEMU 中运行测试
cargo test -- --test-threads=1
```

---

## 6. 模拟不同硬件配置

### 6.1 ARM64 架构

```bash
# 安装 ARM64 工具链
rustup target add aarch64-unknown-none

# 运行 ARM64 QEMU
qemu-system-aarch64 \
    -machine virt \
    -cpu cortex-a72 \
    -m 2G \
    -kernel target/aarch64-unknown-none/release/kairo-kernel \
    -serial mon:stdio \
    -display none
```

### 6.2 RISC-V 架构

```bash
# 安装 RISC-V 工具链
rustup target add riscv64gc-unknown-none-elf

# 运行 RISC-V QEMU
qemu-system-riscv64 \
    -machine virt \
    -m 2G \
    -kernel target/riscv64gc-unknown-none-elf/release/kairo-kernel \
    -serial mon:stdio \
    -display none
```

### 6.3 多核 SMP 测试

```bash
# 模拟 8 核 CPU
qemu-system-x86_64 \
    -smp 8 \
    -m 4G \
    -drive format=raw,file=$KERNEL_IMAGE \
    -serial mon:stdio
```

---

## 7. 性能分析

### 7.1 启用性能计数器

```bash
qemu-system-x86_64 \
    -enable-kvm \
    -cpu host,+perfctr \
    -m 2G \
    -drive format=raw,file=$KERNEL_IMAGE
```

### 7.2 使用 perf 分析

```bash
# 在宿主机上运行 perf
perf record -a -g -- qemu-system-x86_64 ...

# 查看报告
perf report
```

---

## 8. 网络模拟

### 8.1 用户模式网络（NAT）

```bash
qemu-system-x86_64 \
    -netdev user,id=net0,hostfwd=tcp::8080-:80 \
    -device e1000,netdev=net0 \
    -drive format=raw,file=$KERNEL_IMAGE
```

### 8.2 TAP 网络（桥接模式）

```bash
# 创建 TAP 设备（需要 root）
sudo ip tuntap add dev tap0 mode tap
sudo ip link set tap0 up
sudo ip addr add 192.168.100.1/24 dev tap0

# 运行 QEMU
qemu-system-x86_64 \
    -netdev tap,id=net0,ifname=tap0,script=no,downscript=no \
    -device e1000,netdev=net0 \
    -drive format=raw,file=$KERNEL_IMAGE
```

---

## 9. 存储模拟

### 9.1 创建虚拟磁盘

```bash
# 创建 10GB qcow2 磁盘
qemu-img create -f qcow2 disk.img 10G

# 挂载到 QEMU
qemu-system-x86_64 \
    -drive file=disk.img,if=virtio,format=qcow2 \
    -drive format=raw,file=$KERNEL_IMAGE
```

### 9.2 使用 9P 文件系统共享

```bash
# 共享宿主机目录
qemu-system-x86_64 \
    -virtfs local,path=/path/to/share,mount_tag=host0,security_model=passthrough,id=host0 \
    -drive format=raw,file=$KERNEL_IMAGE
```

---

## 10. 自动化测试脚本

### 10.1 CI/CD 集成

```yaml
# .github/workflows/test.yml
name: QEMU Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: nightly
          components: rust-src, llvm-tools-preview

      - name: Install QEMU
        run: sudo apt-get install -y qemu-system-x86

      - name: Install bootimage
        run: cargo install bootimage

      - name: Run tests
        run: cargo test
```

### 10.2 自动化测试脚本

```bash
#!/bin/bash
# test-all.sh

set -e

echo "Building kernel..."
cargo bootimage --release

echo "Running unit tests..."
cargo test --lib

echo "Running integration tests..."
cargo test --test basic_boot
cargo test --test heap_allocation
cargo test --test should_panic

echo "Testing in QEMU..."
timeout 30s qemu-system-x86_64 \
    -drive format=raw,file=target/x86_64-kairo/release/bootimage-kairo-kernel.bin \
    -serial mon:stdio \
    -display none \
    -device isa-debug-exit,iobase=0xf4,iosize=0x04

echo "All tests passed!"
```

---

## 11. 故障排查

### 11.1 常见问题

**问题：QEMU 启动黑屏**
```bash
# 解决方案：启用串口输出
qemu-system-x86_64 -serial mon:stdio -display none ...
```

**问题：内核崩溃无输出**
```bash
# 解决方案：启用调试日志
qemu-system-x86_64 -d int,cpu_reset -D qemu.log ...
```

**问题：KVM 不可用**
```bash
# 检查 KVM 支持
lsmod | grep kvm

# 加载 KVM 模块
sudo modprobe kvm-intel  # Intel CPU
sudo modprobe kvm-amd    # AMD CPU
```

### 11.2 调试技巧

```bash
# 1. 查看 QEMU 日志
qemu-system-x86_64 -d int,cpu_reset,guest_errors -D qemu.log ...

# 2. 启用 QEMU 监视器
qemu-system-x86_64 -monitor stdio ...

# 3. 转储内存
(qemu) pmemsave 0 0x100000 memory.dump

# 4. 查看寄存器
(qemu) info registers

# 5. 单步执行
(qemu) s  # 单步执行一条指令
```

---

## 13. macOS 特定优化

### 13.1 Hypervisor.framework 性能调优

```bash
# 检查 hvf 是否可用
sysctl kern.hv_support
# 输出：kern.hv_support: 1 表示支持

# 优化的 QEMU 配置
qemu-system-x86_64 \
    -accel hvf \
    -cpu host,+invtsc \
    -smp $(sysctl -n hw.ncpu) \
    -m 4G \
    -drive format=raw,file=$KERNEL_IMAGE,cache=writeback \
    -display cocoa,show-cursor=on \
    -usb -device usb-tablet
```

### 13.2 使用 Lima 进行 Linux 开发

如果需要完整的 Linux 环境（例如测试 KVM 或 Linux 特定功能）：

```bash
# 安装 Lima
brew install lima

# 创建 Kairo 开发虚拟机
cat > kairo-dev.yaml <<EOF
arch: "x86_64"
images:
  - location: "https://cloud-images.ubuntu.com/releases/22.04/release/ubuntu-22.04-server-cloudimg-amd64.img"
cpus: 4
memory: "8GiB"
disk: "50GiB"
mounts:
  - location: "~/Desktop/Kairo"
    writable: true
provision:
  - mode: system
    script: |
      apt-get update
      apt-get install -y qemu-system-x86 build-essential
EOF

# 启动虚拟机
limactl start kairo-dev.yaml

# 进入虚拟机
limactl shell kairo-dev

# 在虚拟机中开发
cd ~/Desktop/Kairo
cargo bootimage
qemu-system-x86_64 -enable-kvm ...
```

### 13.3 使用 Docker 构建

```bash
# 创建 Dockerfile
cat > Dockerfile <<EOF
FROM rust:latest

RUN apt-get update && apt-get install -y \\
    qemu-system-x86 \\
    build-essential \\
    && rm -rf /var/lib/apt/lists/*

RUN rustup toolchain install nightly && \\
    rustup default nightly && \\
    rustup component add rust-src llvm-tools-preview && \\
    cargo install bootimage

WORKDIR /workspace
EOF

# 构建镜像
docker build -t kairo-dev .

# 运行容器
docker run -it --rm \\
    -v $(pwd):/workspace \\
    --device /dev/kvm \\
    kairo-dev bash

# 在容器中构建和运行
cargo bootimage
qemu-system-x86_64 -enable-kvm ...
```

### 13.4 macOS 文件系统性能优化

macOS 的 APFS 文件系统在某些场景下可能影响性能：

```bash
# 1. 使用 RAM Disk 加速构建
# 创建 4GB RAM Disk
diskutil erasevolume HFS+ 'RamDisk' `hdiutil attach -nomount ram://8388608`

# 将构建目录移到 RAM Disk
export CARGO_TARGET_DIR=/Volumes/RamDisk/target

# 2. 禁用 Spotlight 索引（可选）
mdutil -i off /path/to/kairo

# 3. 排除 Time Machine 备份
tmutil addexclusion /path/to/kairo/target
```

### 13.5 macOS 调试技巧

```bash
# 1. 使用 Instruments 分析性能
instruments -t "Time Profiler" qemu-system-x86_64 ...

# 2. 查看 QEMU 进程信息
ps aux | grep qemu
lsof -p <qemu_pid>

# 3. 监控资源使用
top -pid <qemu_pid>

# 4. 使用 dtrace 追踪系统调用
sudo dtrace -n 'syscall:::entry /execname == "qemu-system-x86_64"/ { @[probefunc] = count(); }'
```

### 13.6 常见 macOS 问题

**问题 1：hvf 加速不可用**
```bash
# 检查虚拟化支持
sysctl kern.hv_support

# 如果输出 0，可能原因：
# - 在虚拟机中运行（不支持嵌套虚拟化）
# - CPU 不支持 VT-x
# - 系统完整性保护（SIP）问题

# 检查 SIP 状态
csrutil status
```

**问题 2：QEMU 窗口无法显示**
```bash
# 使用 Cocoa 显示后端
qemu-system-x86_64 -display cocoa ...

# 或使用无头模式
qemu-system-x86_64 -display none -serial mon:stdio ...
```

**问题 3：网络不通**
```bash
# macOS 防火墙可能阻止 QEMU
# 系统偏好设置 -> 安全性与隐私 -> 防火墙 -> 防火墙选项
# 允许 qemu-system-x86_64

# 或使用用户模式网络（无需特殊权限）
qemu-system-x86_64 -netdev user,id=net0 -device e1000,netdev=net0 ...
```

**问题 4：权限问题**
```bash
# QEMU 需要访问某些设备
# 授予完全磁盘访问权限：
# 系统偏好设置 -> 安全性与隐私 -> 隐私 -> 完全磁盘访问权限
# 添加 Terminal.app 或 iTerm.app
```

---

## 14. 下一步

完成 QEMU 环境搭建后，可以开始：

1. **实现中断处理**：IDT、PIC、APIC
2. **内存管理**：分页、堆分配器
3. **进程管理**：任务切换、调度器
4. **系统调用**：实现 Linux 兼容的 syscall 接口
5. **设备驱动**：键盘、鼠标、磁盘

参考资源：
- [OSDev Wiki - QEMU](https://wiki.osdev.org/QEMU)
- [QEMU Documentation](https://www.qemu.org/docs/master/)
- [Writing an OS in Rust](https://os.phil-opp.com/)
