use std::path::PathBuf;

fn main() {
    // 构建完成后，使用 bootloader 创建引导镜像
    let _kernel_path = PathBuf::from("target/x86_64-unknown-none/release/kairo-kernel");
    let _out_dir = PathBuf::from("target");

    println!("cargo:rerun-if-changed=src/");

    // 如果是 release 构建，创建引导镜像
    if std::env::var("PROFILE").unwrap_or_default() == "release" {
        println!("cargo:warning=将在构建后创建引导镜像");
    }
}
