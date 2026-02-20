/**
 * Kairo 设计系统 Token 常量
 *
 * 所有颜色使用 KDP RGBA 格式：[r, g, b, a]，范围 0.0-1.0
 * 间距/尺寸单位为 px
 */

// ============================================================
// KDP RGBA 颜色类型
// ============================================================

/** KDP 协议使用的 RGBA 四元组，范围 0.0-1.0 */
export type KdpColor = readonly [number, number, number, number];

// ============================================================
// 背景层级
// ============================================================

/** 最底层背景 #0D0D12 */
export const BG_BASE: KdpColor = [0.051, 0.051, 0.071, 1.0];
/** 窗口主体 #16161E */
export const BG_SURFACE: KdpColor = [0.086, 0.086, 0.118, 0.95];
/** 浮层/弹窗/卡片 #1E1E2A */
export const BG_ELEVATED: KdpColor = [0.118, 0.118, 0.165, 0.92];
/** 下拉菜单/工具提示 #252536 */
export const BG_OVERLAY: KdpColor = [0.145, 0.145, 0.212, 0.88];

// ============================================================
// 文字颜色
// ============================================================

/** 主要文字 #E8E8ED */
export const TEXT_PRIMARY: KdpColor = [0.91, 0.91, 0.93, 1.0];
/** 次要文字/标签 #8E8E9A */
export const TEXT_SECONDARY: KdpColor = [0.557, 0.557, 0.604, 0.8];
/** 占位符/禁用态 #5A5A6E */
export const TEXT_TERTIARY: KdpColor = [0.353, 0.353, 0.431, 0.6];
/** 深色文字（亮色背景上） #0D0D12 */
export const TEXT_INVERSE: KdpColor = [0.051, 0.051, 0.071, 1.0];

// ============================================================
// 品牌色
// ============================================================

/** 主品牌色/链接/焦点 #4A7CFF */
export const BRAND_BLUE: KdpColor = [0.29, 0.486, 1.0, 1.0];
/** 品牌色高亮态 #6B9AFF */
export const BRAND_GLOW: KdpColor = [0.42, 0.604, 1.0, 0.6];
/** 辅助强调色 #3DD6C8 */
export const ACCENT_TEAL: KdpColor = [0.239, 0.839, 0.784, 1.0];

// ============================================================
// 语义色
// ============================================================

/** 成功 #34C759 */
export const SEMANTIC_SUCCESS: KdpColor = [0.204, 0.78, 0.349, 1.0];
/** 警告 #FFB340 */
export const SEMANTIC_WARNING: KdpColor = [1.0, 0.702, 0.251, 1.0];
/** 错误 #FF4D6A */
export const SEMANTIC_ERROR: KdpColor = [1.0, 0.302, 0.416, 1.0];
/** 信息（同品牌蓝） */
export const SEMANTIC_INFO: KdpColor = BRAND_BLUE;

// ============================================================
// 边框/分割线
// ============================================================

/** 默认边框 #2A2A3C */
export const BORDER: KdpColor = [0.165, 0.165, 0.235, 0.5];
/** 分割线 #1E1E2A */
export const DIVIDER: KdpColor = [0.118, 0.118, 0.165, 0.3];
/** 焦点环 #4A7CFF 40% */
export const FOCUS_RING: KdpColor = [0.29, 0.486, 1.0, 0.4];

// ============================================================
// 交互状态色（基于品牌蓝）
// ============================================================

/** 选中态背景 — Kairo Blue 15% */
export const STATE_SELECTED: KdpColor = [0.29, 0.486, 1.0, 0.15];
/** Hover 态边框 — Kairo Blue 30% */
export const STATE_HOVER_BORDER: KdpColor = [0.29, 0.486, 1.0, 0.3];

// ============================================================
// 终端配色方案（Kairo Dark）
// ============================================================

export const TERM_COLORS = {
  black:         [0.102, 0.102, 0.180, 1.0] as KdpColor, // #1A1A2E
  red:           [1.0, 0.302, 0.416, 1.0] as KdpColor,   // #FF4D6A
  green:         [0.204, 0.78, 0.349, 1.0] as KdpColor,   // #34C759
  yellow:        [1.0, 0.702, 0.251, 1.0] as KdpColor,    // #FFB340
  blue:          [0.29, 0.486, 1.0, 1.0] as KdpColor,     // #4A7CFF
  magenta:       [0.78, 0.49, 1.0, 1.0] as KdpColor,      // #C77DFF
  cyan:          [0.239, 0.839, 0.784, 1.0] as KdpColor,   // #3DD6C8
  white:         [0.91, 0.91, 0.93, 1.0] as KdpColor,     // #E8E8ED
  brightBlack:   [0.227, 0.227, 0.322, 1.0] as KdpColor,  // #3A3A52
  brightRed:     [1.0, 0.478, 0.561, 1.0] as KdpColor,    // #FF7A8F
  brightGreen:   [0.373, 0.878, 0.478, 1.0] as KdpColor,  // #5FE07A
  brightYellow:  [1.0, 0.816, 0.416, 1.0] as KdpColor,    // #FFD06A
  brightBlue:    [0.42, 0.604, 1.0, 1.0] as KdpColor,     // #6B9AFF
  brightMagenta: [0.851, 0.639, 1.0, 1.0] as KdpColor,    // #D9A3FF
  brightCyan:    [0.42, 0.91, 0.867, 1.0] as KdpColor,    // #6BE8DD
  brightWhite:   [1.0, 1.0, 1.0, 1.0] as KdpColor,       // #FFFFFF
  foreground:    [0.91, 0.91, 0.93, 1.0] as KdpColor,     // #E8E8ED
  background:    [0.051, 0.051, 0.071, 1.0] as KdpColor,  // #0D0D12
} as const;

// ============================================================
// 排版（字号层级）
// ============================================================

export const FONT = {
  display: { size: 32, lineHeight: 40, weight: 600 },
  title:   { size: 20, lineHeight: 28, weight: 600 },
  heading: { size: 16, lineHeight: 24, weight: 600 },
  body:    { size: 14, lineHeight: 20, weight: 400 },
  caption: { size: 12, lineHeight: 16, weight: 400 },
  mono:    { size: 13, lineHeight: 18, weight: 400 },
} as const;

/**
 * 当前 KDP 位图字体的 scale 映射
 * 8x8 位图字体，scale=1 → 8px，scale=2 → 16px，scale=4 → 32px
 */
export const BITMAP_SCALE = {
  display: 4,  // 32px
  title:   3,  // 24px（近似 20px）
  heading: 2,  // 16px
  body:    2,  // 16px（近似 14px）
  caption: 1,  // 8px（近似 12px）
  mono:    2,  // 16px（近似 13px）
} as const;

// ============================================================
// 间距系统（4px 网格）
// ============================================================

export const SPACING = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  xxxl: 48,
} as const;

// ============================================================
// 圆角（标准 border-radius，非 Squircle）
// ============================================================

export const RADIUS = {
  none: 0,
  sm:   4,
  md:   8,
  lg:   12,
  xl:   16,
} as const;

// ============================================================
// 窗口通用尺寸
// ============================================================

export const WINDOW = {
  titleBarHeight: 36,
  statusBarHeight: 28,
  paddingX: 16,
  paddingY: 12,
  sidebarWidth: 220,
  controlButtonSize: 16,
  controlButtonGap: 4,
  controlButtonMarginTop: 10,
  controlButtonMarginRight: 12,
} as const;
