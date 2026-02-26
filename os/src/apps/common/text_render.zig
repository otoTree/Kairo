// FreeType 文字渲染 — 渲染到 ARGB8888 像素缓冲区
// 字体加载逻辑复用自 os/src/shell/river/KairoDisplay.zig:9-66
const std = @import("std");
const draw = @import("draw");

const ft = @cImport({
    @cInclude("ft2build.h");
    @cInclude("freetype/freetype.h");
});

pub const TextRenderer = struct {
    ft_library: ft.FT_Library,
    ft_face: ft.FT_Face,

    /// 初始化 FreeType 并加载系统字体
    pub fn init() !TextRenderer {
        var lib: ft.FT_Library = null;
        if (ft.FT_Init_FreeType(&lib) != 0) {
            return error.FreeTypeInitFailed;
        }

        // 按优先级尝试多个系统字体路径（与 KairoDisplay.zig 一致）
        const font_paths = [_][*:0]const u8{
            "/usr/share/fonts/dejavu/DejaVuSansMono.ttf", // Alpine
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", // Debian/Ubuntu
            "/usr/share/fonts/TTF/DejaVuSansMono.ttf", // Arch
            "/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf", // Fedora
            "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf",
            "/usr/share/fonts/noto/NotoSansMono-Regular.ttf",
        };

        for (font_paths) |path| {
            var face: ft.FT_Face = null;
            if (ft.FT_New_Face(lib, path, 0, &face) == 0) {
                std.debug.print("kairo-app: 加载字体: {s}\n", .{path});
                return TextRenderer{
                    .ft_library = lib,
                    .ft_face = face,
                };
            }
        }

        return error.NoFontFound;
    }

    /// 渲染文字到像素缓冲区
    pub fn renderText(
        self: *TextRenderer,
        buf: [*]u32,
        buf_w: u32,
        buf_h: u32,
        x: i32,
        y: i32,
        text: []const u8,
        color: u32,
        size_px: u32,
    ) void {
        if (ft.FT_Set_Pixel_Sizes(self.ft_face, 0, size_px) != 0) return;

        const ascender: i32 = @intCast(@divFloor(
            self.ft_face.*.size.*.metrics.ascender,
            64,
        ));
        var pen_x = x;

        for (text) |ch| {
            if (ch < 32) {
                pen_x += @intCast(@divFloor(size_px, 2));
                continue;
            }

            if (ft.FT_Load_Char(self.ft_face, ch, ft.FT_LOAD_RENDER) != 0) {
                pen_x += @intCast(@divFloor(size_px, 2));
                continue;
            }

            const glyph = self.ft_face.*.glyph;
            const bitmap = glyph.*.bitmap;
            const glyph_left: i32 = @intCast(glyph.*.bitmap_left);
            const glyph_top: i32 = @intCast(glyph.*.bitmap_top);

            // 将字形位图逐像素写入缓冲区（带 alpha 混合）
            if (bitmap.buffer != null and bitmap.rows > 0 and bitmap.width > 0) {
                var row: u32 = 0;
                while (row < bitmap.rows) : (row += 1) {
                    const pitch: usize = @intCast(bitmap.pitch);
                    var col: u32 = 0;
                    while (col < bitmap.width) : (col += 1) {
                        const alpha = bitmap.buffer[row * pitch + col];
                        if (alpha == 0) continue;

                        const px = pen_x + glyph_left + @as(i32, @intCast(col));
                        const py = y + ascender - glyph_top + @as(i32, @intCast(row));
                        if (px < 0 or py < 0 or px >= @as(i32, @intCast(buf_w)) or py >= @as(i32, @intCast(buf_h))) continue;

                        const idx = @as(usize, @intCast(py)) * buf_w + @as(usize, @intCast(px));
                        // 将灰度值作为 alpha 与前景色混合
                        const src_color = blendAlphaWithColor(color, alpha);
                        buf[idx] = draw.alphaBlend(buf[idx], src_color);
                    }
                }
            }

            pen_x += @intCast(@divFloor(glyph.*.advance.x, 64));
        }
    }

    /// 测量文字宽度（像素）
    pub fn measureText(self: *TextRenderer, text: []const u8, size_px: u32) u32 {
        if (ft.FT_Set_Pixel_Sizes(self.ft_face, 0, size_px) != 0) return 0;

        var width: i32 = 0;
        for (text) |ch| {
            if (ch < 32) {
                width += @intCast(@divFloor(size_px, 2));
                continue;
            }
            if (ft.FT_Load_Char(self.ft_face, ch, ft.FT_LOAD_RENDER) != 0) {
                width += @intCast(@divFloor(size_px, 2));
                continue;
            }
            width += @intCast(@divFloor(self.ft_face.*.glyph.*.advance.x, 64));
        }
        return @intCast(@max(width, 0));
    }

    pub fn deinit(self: *TextRenderer) void {
        _ = ft.FT_Done_Face(self.ft_face);
        _ = ft.FT_Done_FreeType(self.ft_library);
    }
};

/// 将颜色的 RGB 与字形灰度值组合为 ARGB8888
fn blendAlphaWithColor(color: u32, glyph_alpha: u8) u32 {
    const ca = (color >> 24) & 0xFF;
    const cr = (color >> 16) & 0xFF;
    const cg = (color >> 8) & 0xFF;
    const cb = color & 0xFF;
    // 最终 alpha = 颜色 alpha × 字形灰度 / 255
    const fa = (ca * glyph_alpha + 127) / 255;
    return (fa << 24) | (cr << 16) | (cg << 8) | cb;
}
