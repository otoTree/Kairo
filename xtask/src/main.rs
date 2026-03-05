use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("🔨 构建 Kairo OS 内核...");

    // 获取 xtask 的父目录（即 Kairo 目录）
    let kairo_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    let kernel_dir = kairo_dir.join("kairo-kernel");

    // 构建内核
    let status = Command::new("sh")
        .args(&[
            "-c",
            &format!("cd {} && $HOME/.cargo/bin/cargo +nightly build --release -Z build-std=core,compiler_builtins,alloc -Z build-std-features=compiler-builtins-mem", kernel_dir.display())
        ])
        .status()
        .expect("无法执行 cargo build");

    if !status.success() {
        eprintln!("❌ 内核构建失败！");
        std::process::exit(1);
    }

    let kernel_path = kernel_dir.join("target/x86_64-unknown-none/release/kairo-kernel");

    if !kernel_path.exists() {
        eprintln!("❌ 找不到内核文件: {:?}", kernel_path);
        std::process::exit(1);
    }

    println!("✅ 内核构建成功！");
    println!("📁 内核: {:?}", kernel_path);

    // 创建 BIOS 引导镜像
    println!("\n🔧 创建 BIOS 引导镜像...");

    let output_path = kernel_dir.join("target/kairo-os.img");

    // 使用 bootloader crate 的 API
    bootloader::BiosBoot::new(&kernel_path)
        .create_disk_image(&output_path)
        .expect("无法创建引导镜像");

    println!("✅ 引导镜像创建成功！");
    println!("📁 镜像: {:?}", output_path);
    println!("\n🚀 运行命令:");
    println!("qemu-system-x86_64 -drive format=raw,file={} -serial mon:stdio -display cocoa -m 512M", output_path.display());
}
