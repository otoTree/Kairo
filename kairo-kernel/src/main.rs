// Kairo OS 内核 - 最小可引导版本
#![no_std]  // 不使用标准库
#![no_main] // 不使用标准的 main 入口点

use core::panic::PanicInfo;
use bootloader_api::{entry_point, BootInfo};

mod vga_buffer;
mod boot_config;
mod serial;

// 使用 bootloader_api 的 entry_point 宏定义入口点，并指定配置
entry_point!(kernel_main, config = &boot_config::BOOTLOADER_CONFIG);

/// 内核入口点
fn kernel_main(boot_info: &'static mut BootInfo) -> ! {
    serial_println!("=== Kairo OS 内核启动 ===");
    serial_println!("内核入口点已执行");

    // 直接测试 framebuffer（跳过 VGA 缓冲区测试）
    serial_println!("检查 framebuffer...");
    if let Some(framebuffer) = boot_info.framebuffer.as_mut() {
        serial_println!("Framebuffer 可用！");
        let info = framebuffer.info();
        serial_println!("  宽度: {}", info.width);
        serial_println!("  高度: {}", info.height);
        serial_println!("  stride: {}", info.stride);
        serial_println!("  bytes_per_pixel: {}", info.bytes_per_pixel);

        let buffer = framebuffer.buffer_mut();
        serial_println!("  buffer 长度: {}", buffer.len());

        serial_println!("清屏为黑色...");
        // 清屏为黑色
        for byte in buffer.iter_mut() {
            *byte = 0;
        }
        serial_println!("清屏完成");

        serial_println!("绘制白色矩形...");
        // 在左上角画一个白色矩形（测试）
        for y in 0..100 {
            for x in 0..200 {
                let pixel_offset = y * info.stride + x;
                let color_offset = pixel_offset * info.bytes_per_pixel;
                if color_offset + 2 < buffer.len() {
                    buffer[color_offset] = 255;     // B
                    buffer[color_offset + 1] = 255; // G
                    buffer[color_offset + 2] = 255; // R
                }
            }
        }
        serial_println!("白色矩形绘制完成");
    } else {
        serial_println!("Framebuffer 不可用！");
    }

    serial_println!("内核初始化完成，进入主循环");

    // 进入空闲循环（使用 hlt 指令节能）
    loop {
        x86_64::instructions::hlt();
    }
}

/// Panic 处理器
/// 当程序 panic 时会调用这个函数
#[panic_handler]
fn panic(info: &PanicInfo) -> ! {
    serial_println!();
    serial_println!("!!! KERNEL PANIC !!!");
    serial_println!("{}", info);

    println!();
    println!("!!! KERNEL PANIC !!!");
    println!("{}", info);

    // 进入死循环
    loop {
        x86_64::instructions::hlt();
    }
}
