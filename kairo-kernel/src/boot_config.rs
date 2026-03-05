// Bootloader 配置
// 使用动态物理内存映射

use bootloader_api::config::{BootloaderConfig, Mapping};

pub const BOOTLOADER_CONFIG: BootloaderConfig = {
    let mut config = BootloaderConfig::new_default();
    // 使用恒等映射（identity mapping）来简化内存访问
    config.mappings.physical_memory = Some(Mapping::Dynamic);
    config
};
