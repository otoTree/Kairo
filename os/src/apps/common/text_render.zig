// FreeType 文字渲染 — 渲染到 ARGB8888 像素缓冲区
// 字体加载逻辑复用自 os/src/shell/river/KairoDisplay.zig:9-66
const std = @import("std");
const draw = @import("draw");

const ft = @cImport({
    @cInclude("ft2build.h");
    @cInclude("freetype/freetype.h");
});

/// 缓存的字形数据
const CachedGlyph = struct {
    width: u32,
    rows: u32,
    pitch: i32,
    bitmap_left: i32,
    bitmap_top: i32,
    advance_x: i32,
    bitmap_data: []u8, // 拥有的位图副本
};

/// 缓存键：字符 + 字号
const GlyphKey = struct {
    char: u8,
    size: u32,
};

pub const TextRenderer = struct {
    ft_library: ft.FT_Library,
    ft_face: ft.FT_Face,
    // 字形缓存：避免每帧重复调用 FT_Load_Char
    glyph_cache: std.AutoHashMap(GlyphKey, CachedGlyph),
    cache_allocator: std.mem.Allocator,

    /// 初始化 FreeType 并加载系统字体
    pub fn init() !TextRenderer {
        return initWithAllocator(std.heap.page_allocator);
    }

    pub fn initWithAllocator(allocator: std.mem.Allocator) !TextRenderer {
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
                    .glyph_cache = std.AutoHashMap(GlyphKey, CachedGlyph).init(allocator),
                    .cache_allocator = allocator,
                };
            }
        }

        return error.NoFontFound;
    }

    /// 获取或缓存字形数据
    fn getGlyph(self: *TextRenderer, ch: u8, size_px: u32) ?*const CachedGlyph {
        const key = GlyphKey{ .char = ch, .size = size_px };
        if (self.glyph_cache.getPtr(key)) |cached| return cached;

        // 缓存未命中，调用 FreeType 光栅化
        if (ft.FT_Set_Pixel_Sizes(self.ft_face, 0, size_px) != 0) return null;
        if (ft.FT_Load_Char(self.ft_face, ch, ft.FT_LOAD_RENDER) != 0) return null;

        const glyph = self.ft_face.*.glyph;
        const bitmap = glyph.*.bitmap;
        const data_len = @as(usize, bitmap.rows) * @as(usize, @intCast(@max(bitmap.pitch, 0)));

        // 复制位图数据到自有内存
        const bitmap_copy: []u8 = if (data_len > 0 and bitmap.buffer != null)
            self.cache_allocator.dupe(u8, bitmap.buffer[0..data_len]) catch return null
        else
            self.cache_allocator.alloc(u8, 0) catch return null;

        const cached = CachedGlyph{
            .width = bitmap.width,
            .rows = bitmap.rows,
            .pitch = bitmap.pitch,
            .bitmap_left = @intCast(glyph.*.bitmap_left),
            .bitmap_top = @intCast(glyph.*.bitmap_top),
            .advance_x = @intCast(@divFloor(glyph.*.advance.x, 64)),
            .bitmap_data = bitmap_copy,
        };

        self.glyph_cache.put(key, cached) catch return null;
        return self.glyph_cache.getPtr(key);
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

            const cached = self.getGlyph(ch, size_px) orelse {
                pen_x += @intCast(@divFloor(size_px, 2));
                continue;
            };

            // 将缓存的字形位图逐像素写入缓冲区（带 alpha 混合）
            if (cached.bitmap_data.len > 0 and cached.rows > 0 and cached.width > 0) {
                const pitch: usize = @intCast(@max(cached.pitch, 0));
                var row: u32 = 0;
                while (row < cached.rows) : (row += 1) {
                    var col: u32 = 0;
                    while (col < cached.width) : (col += 1) {
                        const alpha = cached.bitmap_data[row * pitch + col];
                        if (alpha == 0) continue;

                        const px = pen_x + cached.bitmap_left + @as(i32, @intCast(col));
                        const py = y + ascender - cached.bitmap_top + @as(i32, @intCast(row));
                        if (px < 0 or py < 0 or px >= @as(i32, @intCast(buf_w)) or py >= @as(i32, @intCast(buf_h))) continue;

                        const idx = @as(usize, @intCast(py)) * buf_w + @as(usize, @intCast(px));
                        const src_color = blendAlphaWithColor(color, alpha);
                        buf[idx] = draw.alphaBlend(buf[idx], src_color);
                    }
                }
            }

            pen_x += cached.advance_x;
        }
    }

    /// 测量文字宽度（像素），使用字形缓存
    pub fn measureText(self: *TextRenderer, text: []const u8, size_px: u32) u32 {
        var width: i32 = 0;
        for (text) |ch| {
            if (ch < 32) {
                width += @intCast(@divFloor(size_px, 2));
                continue;
            }
            if (self.getGlyph(ch, size_px)) |cached| {
                width += cached.advance_x;
            } else {
                width += @intCast(@divFloor(size_px, 2));
            }
        }
        return @intCast(@max(width, 0));
    }

    pub fn deinit(self: *TextRenderer) void {
        // 释放缓存的位图数据
        var it = self.glyph_cache.valueIterator();
        while (it.next()) |cached| {
            if (cached.bitmap_data.len > 0) {
                self.cache_allocator.free(cached.bitmap_data);
            }
        }
        self.glyph_cache.deinit();
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
