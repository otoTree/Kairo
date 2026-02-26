// 基础绘图原语 — 操作 ARGB8888 像素缓冲区

/// Porter-Duff over 运算：将 src 混合到 dst 上
pub fn alphaBlend(dst: u32, src: u32) u32 {
    const sa = (src >> 24) & 0xFF;
    if (sa == 0) return dst;
    if (sa == 255) return src;

    const sr = (src >> 16) & 0xFF;
    const sg = (src >> 8) & 0xFF;
    const sb = src & 0xFF;
    const da = (dst >> 24) & 0xFF;
    const dr = (dst >> 16) & 0xFF;
    const dg = (dst >> 8) & 0xFF;
    const db = dst & 0xFF;

    const inv_sa = 255 - sa;
    const oa = sa + (da * inv_sa + 127) / 255;
    const or_ = (sr * sa + dr * inv_sa + 127) / 255;
    const og = (sg * sa + dg * inv_sa + 127) / 255;
    const ob = (sb * sa + db * inv_sa + 127) / 255;

    return (oa << 24) | (or_ << 16) | (og << 8) | ob;
}

/// 填充矩形（带 alpha 混合）
pub fn fillRect(
    buf: [*]u32,
    buf_w: u32,
    buf_h: u32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    color: u32,
) void {
    // 裁剪到缓冲区范围
    const x0: u32 = @intCast(@max(x, 0));
    const y0: u32 = @intCast(@max(y, 0));
    const x1: u32 = @intCast(@min(@max(x + w, 0), @as(i32, @intCast(buf_w))));
    const y1: u32 = @intCast(@min(@max(y + h, 0), @as(i32, @intCast(buf_h))));

    const is_opaque = ((color >> 24) & 0xFF) == 255;
    var py = y0;
    while (py < y1) : (py += 1) {
        var px = x0;
        while (px < x1) : (px += 1) {
            const idx = py * buf_w + px;
            if (is_opaque) {
                buf[idx] = color;
            } else {
                buf[idx] = alphaBlend(buf[idx], color);
            }
        }
    }
}

/// 填充圆角矩形
pub fn fillRoundRect(
    buf: [*]u32,
    buf_w: u32,
    buf_h: u32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    r: i32,
    color: u32,
) void {
    if (r <= 0 or w <= 0 or h <= 0) {
        fillRect(buf, buf_w, buf_h, x, y, w, h, color);
        return;
    }
    const radius = @min(r, @min(@divFloor(w, 2), @divFloor(h, 2)));

    // 中间矩形（不含圆角行）
    fillRect(buf, buf_w, buf_h, x, y + radius, w, h - 2 * radius, color);

    // 上下圆角区域：逐行计算水平范围
    var dy: i32 = 0;
    while (dy < radius) : (dy += 1) {
        // 圆心到当前行的距离
        const ry = radius - dy;
        // 水平半径：sqrt(r^2 - ry^2)
        const r2 = radius * radius;
        const ry2 = ry * ry;
        const rx = isqrt(@as(u32, @intCast(r2 - ry2)));

        // 上圆角行
        const top_y = y + dy;
        fillRect(buf, buf_w, buf_h, x + radius - rx, top_y, w - 2 * (radius - rx), 1, color);

        // 下圆角行
        const bot_y = y + h - 1 - dy;
        fillRect(buf, buf_w, buf_h, x + radius - rx, bot_y, w - 2 * (radius - rx), 1, color);
    }
}

/// 水平线
pub fn drawHLine(
    buf: [*]u32,
    buf_w: u32,
    buf_h: u32,
    x: i32,
    y: i32,
    w: i32,
    color: u32,
) void {
    fillRect(buf, buf_w, buf_h, x, y, w, 1, color);
}

/// 整数平方根（牛顿法）
fn isqrt(n: u32) i32 {
    if (n == 0) return 0;
    var x: u32 = n;
    var y: u32 = (x + 1) / 2;
    while (y < x) {
        x = y;
        y = (x + n / x) / 2;
    }
    return @intCast(x);
}
