// 设计系统颜色常量（ARGB8888 格式）
// 从 src/domains/ui/tokens.ts 移植

/// 将 RGBA 浮点值转换为 ARGB8888
pub fn rgba(r: f32, g: f32, b: f32, a: f32) u32 {
    const ai: u32 = @intFromFloat(a * 255.0);
    const ri: u32 = @intFromFloat(r * 255.0);
    const gi: u32 = @intFromFloat(g * 255.0);
    const bi: u32 = @intFromFloat(b * 255.0);
    return (ai << 24) | (ri << 16) | (gi << 8) | bi;
}

/// 提取 alpha 分量 (0-255)
pub fn getAlpha(color: u32) u8 {
    return @truncate(color >> 24);
}

// === 背景层级 ===
pub const BG_BASE: u32 = 0xFF0D0D12; // #0D0D12
pub const BG_SURFACE: u32 = 0xF216161E; // #16161E α=0.95
pub const BG_ELEVATED: u32 = 0xEB1E1E2A; // #1E1E2A α=0.92
pub const BG_OVERLAY: u32 = 0xE0252536; // #252536 α=0.88

// === 文字颜色 ===
pub const TEXT_PRIMARY: u32 = 0xFFE8E8ED; // #E8E8ED
pub const TEXT_SECONDARY: u32 = 0xCC8E8E9A; // #8E8E9A α=0.80
pub const TEXT_TERTIARY: u32 = 0x995A5A6E; // #5A5A6E α=0.60
pub const TEXT_INVERSE: u32 = 0xFF0D0D12; // #0D0D12

// === 品牌色 ===
pub const BRAND_BLUE: u32 = 0xFF4A7CFF; // #4A7CFF
pub const BRAND_GLOW: u32 = 0x996B9AFF; // #6B9AFF α=0.60
pub const ACCENT_TEAL: u32 = 0xFF3DD6C8; // #3DD6C8

// === 语义色 ===
pub const SEMANTIC_SUCCESS: u32 = 0xFF34C759; // #34C759
pub const SEMANTIC_WARNING: u32 = 0xFFFFB340; // #FFB340
pub const SEMANTIC_ERROR: u32 = 0xFFFF4D6A; // #FF4D6A

// === 边框和分隔线 ===
pub const BORDER: u32 = 0x802A2A3C; // #2A2A3C α=0.50
pub const DIVIDER: u32 = 0x4D2A2A3C; // #2A2A3C α=0.30
pub const FOCUS_RING: u32 = 0x664A7CFF; // #4A7CFF α=0.40
