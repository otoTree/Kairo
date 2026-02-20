const std = @import("std");
const wayland = @import("wayland");
const wl = wayland.server.wl;
const wlr = @import("wlroots");
const Server = @import("Server.zig");
const kairo = wayland.server.kairo;

const ft = @cImport({
    @cInclude("ft2build.h");
    @cInclude("freetype/freetype.h");
});

const log = std.log.scoped(.kairo_display);

const KairoDisplay = @This();

global: *wl.Global,
server: *Server,
/// FreeType 库实例（全局共享）
ft_library: ?ft.FT_Library = null,
/// 已加载的字体 face
ft_face: ?ft.FT_Face = null,

pub fn init(self: *KairoDisplay) !void {
    self.server = @fieldParentPtr("kairo_display", self);
    self.global = try wl.Global.create(
        self.server.wl_server,
        kairo.DisplayV1,
        1,
        *KairoDisplay,
        self,
        bind,
    );

    // 初始化 FreeType
    self.ft_library = null;
    self.ft_face = null;
    var lib: ft.FT_Library = null;
    if (ft.FT_Init_FreeType(&lib) != 0) {
        log.warn("KDP: FreeType 初始化失败，将使用位图字体", .{});
        return;
    }
    self.ft_library = lib;

    // 尝试加载系统字体（按优先级尝试多个路径）
    const font_paths = [_][*:0]const u8{
        "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",           // Alpine
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",  // Debian/Ubuntu
        "/usr/share/fonts/TTF/DejaVuSansMono.ttf",              // Arch
        "/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf", // Fedora
        "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf",
        "/usr/share/fonts/noto/NotoSansMono-Regular.ttf",
    };

    for (font_paths) |path| {
        var face: ft.FT_Face = null;
        if (ft.FT_New_Face(lib, path, 0, &face) == 0) {
            self.ft_face = face;
            log.info("KDP: FreeType 加载字体: {s}", .{path});
            return;
        }
    }

    log.warn("KDP: 未找到系统字体，将使用位图字体", .{});
    self.ft_face = null;
}

fn bind(client: *wl.Client, self: *KairoDisplay, version: u32, id: u32) void {
    const resource = kairo.DisplayV1.create(client, version, id) catch {
        client.postNoMemory();
        return;
    };
    resource.setHandler(*KairoDisplay, handleRequest, handleDestroy, self);
}

fn handleDestroy(resource: *kairo.DisplayV1, _: *KairoDisplay) void {
    _ = resource;
}

fn handleRequest(
    resource: *kairo.DisplayV1,
    request: kairo.DisplayV1.Request,
    self: *KairoDisplay,
) void {
    switch (request) {
        .get_kairo_surface => |args| {
            createKairoSurface(resource, args.id, args.surface, self);
        },
    }
}

fn createKairoSurface(
    display_resource: *kairo.DisplayV1,
    id: u32,
    surface_resource: *wl.Surface,
    self: *KairoDisplay,
) void {
    const client = display_resource.getClient();
    const allocator = std.heap.c_allocator;

    const kairo_surface = allocator.create(KairoSurface) catch {
        client.postNoMemory();
        return;
    };
    errdefer allocator.destroy(kairo_surface);

    const resource = kairo.SurfaceV1.create(client, 1, id) catch {
        client.postNoMemory();
        return;
    };

    kairo_surface.* = .{
        .server = self.server,
        .surface_resource = surface_resource,
        .resource = resource,
        .display = self,
    };

    resource.setHandler(*KairoSurface, KairoSurface.handleRequest, KairoSurface.handleDestroy, kairo_surface);
}

// ============================================================
// KairoSurface: 接收 JSON UI 树并渲染到 overlay 层
// ============================================================

const KairoSurface = struct {
    server: *Server,
    surface_resource: *wl.Surface,
    resource: *kairo.SurfaceV1,
    display: *KairoDisplay,
    /// overlay 子树，用于管理所有渲染节点的生命周期
    overlay_tree: ?*wlr.SceneTree = null,
    /// 可交互元素的命中区域列表（用于 user_action 事件）
    hit_regions: std.ArrayList(HitRegion) = .{},
    /// 当前 hover 的元素 ID（用于 hover enter/leave 检测）
    hovered_element_id: ?[]const u8 = null,

    const HitRegion = struct {
        element_id: []const u8,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        action_type: []const u8, // "click", "submit" 等
    };

    fn handleDestroy(resource: *kairo.SurfaceV1, self: *KairoSurface) void {
        _ = resource;
        if (self.overlay_tree) |tree| {
            tree.node.destroy();
        }
        self.hit_regions.deinit(std.heap.c_allocator);
        std.heap.c_allocator.destroy(self);
    }

    fn handleRequest(
        resource: *kairo.SurfaceV1,
        request: kairo.SurfaceV1.Request,
        self: *KairoSurface,
    ) void {
        switch (request) {
            .commit_ui_tree => |args| {
                const payload = std.mem.span(args.json_payload);
                const MAX_PAYLOAD_SIZE = 64 * 1024;
                if (payload.len > MAX_PAYLOAD_SIZE) {
                    log.err("KDP: payload 超过大小限制 ({} > {})", .{ payload.len, MAX_PAYLOAD_SIZE });
                    return;
                }
                if (payload.len == 0) {
                    log.warn("KDP: 收到空 payload，忽略", .{});
                    return;
                }
                log.info("KDP: Received UI Tree: {s}", .{payload});
                self.renderUITree(payload);
            },
            .destroy => {
                resource.destroy();
            },
        }
    }

    /// 处理指针点击事件，进行命中测试并发送 user_action
    pub fn handlePointerClick(self: *KairoSurface, x: i32, y: i32) void {
        for (self.hit_regions.items) |region| {
            if (x >= region.x and x < region.x + region.width and
                y >= region.y and y < region.y + region.height)
            {
                // 命中！发送 user_action 事件
                log.info("KDP: user_action hit: {s} at ({}, {})", .{ region.element_id, x, y });
                self.sendUserAction(region.element_id, region.action_type, "{}");
                return;
            }
        }
    }

    /// 处理指针移动事件，检测 hover enter/leave 并发送事件
    pub fn handlePointerMotion(self: *KairoSurface, x: i32, y: i32) void {
        var new_hover: ?[]const u8 = null;

        // 命中测试：查找当前指针下的可交互元素
        for (self.hit_regions.items) |region| {
            if (x >= region.x and x < region.x + region.width and
                y >= region.y and y < region.y + region.height)
            {
                new_hover = region.element_id;
                break;
            }
        }

        // 检测 hover 状态变化
        const old_hover = self.hovered_element_id;
        const changed = if (old_hover) |old| blk: {
            if (new_hover) |new_h| {
                break :blk !std.mem.eql(u8, old, new_h);
            }
            break :blk true;
        } else new_hover != null;

        if (changed) {
            // 发送 hover leave 事件
            if (old_hover) |old_id| {
                self.sendUserAction(old_id, "hover_leave", "{}");
            }
            // 发送 hover enter 事件
            if (new_hover) |new_id| {
                self.sendUserAction(new_id, "hover", "{}");
            }
            self.hovered_element_id = new_hover;
        }

        // 始终发送 pointer_event（motion）到客户端
        self.sendPointerEvent(x, y, 0);
    }

    /// 通过 Wayland 协议发送 user_action 事件到客户端
    fn sendUserAction(self: *KairoSurface, element_id: []const u8, action_type: []const u8, payload: []const u8) void {
        self.resource.sendUserAction(
            @ptrCast(element_id.ptr),
            @ptrCast(action_type.ptr),
            @ptrCast(payload.ptr),
        );
    }

    /// 发送键盘事件到客户端
    pub fn sendKeyEvent(self: *KairoSurface, key: u32, state: u32, modifiers: u32) void {
        self.resource.sendKeyEvent(key, state, modifiers);
        log.info("KDP: key_event key={} state={} mods={}", .{ key, state, modifiers });
    }

    /// 发送指针事件到客户端
    pub fn sendPointerEvent(self: *KairoSurface, x: i32, y: i32, event_type: u32) void {
        self.resource.sendPointerEvent(x, y, event_type);
    }

    /// 发送焦点事件到客户端
    pub fn sendFocusEvent(self: *KairoSurface, focused: u32) void {
        self.resource.sendFocusEvent(focused);
        log.info("KDP: focus_event focused={}", .{focused});
    }

    /// 解析 JSON UI 树并渲染到 overlay 场景层
    fn renderUITree(self: *KairoSurface, json_payload: [:0]const u8) void {
        // 清理旧的 overlay 节点和命中区域
        if (self.overlay_tree) |tree| {
            tree.node.destroy();
            self.overlay_tree = null;
        }
        self.hit_regions.clearRetainingCapacity();

        const overlay_parent = self.server.scene.layers.overlay;
        const tree = overlay_parent.createSceneTree() catch {
            log.err("KDP: 无法创建 overlay 子树", .{});
            return;
        };
        self.overlay_tree = tree;

        const parsed = std.json.parseFromSlice(UIElement, std.heap.c_allocator, json_payload, .{
            .ignore_unknown_fields = true,
        }) catch |err| {
            log.err("KDP: JSON 解析失败: {}", .{err});
            return;
        };
        defer parsed.deinit();

        // 递归渲染 UI 元素，同时收集可交互区域
        renderElementWithHitTest(tree, &parsed.value, self, 0, 0);
        log.info("KDP: UI 树渲染完成 (可交互区域: {})", .{self.hit_regions.items.len});
    }
};

// ============================================================
// UI 元素定义与渲染
// ============================================================

const UIElement = struct {
    @"type": []const u8 = "",
    id: ?[]const u8 = null,
    x: ?i32 = null,
    y: ?i32 = null,
    width: ?i32 = null,
    height: ?i32 = null,
    color: ?[4]f32 = null,
    text: ?[]const u8 = null,
    scale: ?i32 = null,
    action: ?[]const u8 = null,
    radius: ?i32 = null,
    border_width: ?i32 = null,
    border_color: ?[4]f32 = null,
    /// px 级字号（优先于 scale，通过 scale = font_size / 8 近似）
    font_size: ?i32 = null,
    /// scroll 节点：内容总高度
    scroll_height: ?i32 = null,
    /// scroll 节点：当前滚动偏移
    scroll_offset: ?i32 = null,
    /// image 节点：图片路径或 base64
    src: ?[]const u8 = null,
    /// input 节点：占位符
    placeholder: ?[]const u8 = null,
    /// input 节点：当前值
    value: ?[]const u8 = null,
    /// input 节点：是否获得焦点
    focused: ?bool = null,
    children: ?[]const UIElement = null,
};

/// 递归渲染 UI 元素到场景树（同时收集可交互区域用于命中测试）
fn renderElementWithHitTest(parent: *wlr.SceneTree, element: *const UIElement, surface: *KairoSurface, offset_x: i32, offset_y: i32) void {
    const elem_type = element.@"type";
    const ex = (element.x orelse 0) + offset_x;
    const ey = (element.y orelse 0) + offset_y;

    if (std.mem.eql(u8, elem_type, "rect")) {
        renderRect(parent, element);
    } else if (std.mem.eql(u8, elem_type, "text")) {
        renderText(parent, element, surface.display);
    } else if (std.mem.eql(u8, elem_type, "scroll")) {
        renderScroll(parent, element, surface, ex, ey);
        return; // scroll 内部递归处理子元素
    } else if (std.mem.eql(u8, elem_type, "clip")) {
        renderClip(parent, element, surface, ex, ey);
        return; // clip 内部递归处理子元素
    } else if (std.mem.eql(u8, elem_type, "input")) {
        renderInput(parent, element);
    } else if (std.mem.eql(u8, elem_type, "image")) {
        renderImage(parent, element);
    }

    // 如果元素有 action 属性，注册命中区域用于交互
    if (element.action) |action| {
        const eid = element.id orelse "anonymous";
        const w = element.width orelse 100;
        const h = element.height orelse 40;
        surface.hit_regions.append(std.heap.c_allocator, .{
            .element_id = eid,
            .x = ex,
            .y = ey,
            .width = w,
            .height = h,
            .action_type = action,
        }) catch {};
    }

    // 递归渲染子元素
    if (element.children) |children| {
        for (children) |*child| {
            renderElementWithHitTest(parent, child, surface, ex, ey);
        }
    }
}

/// 兼容旧接口：不收集命中区域的渲染
fn renderElement(parent: *wlr.SceneTree, element: *const UIElement) void {
    const elem_type = element.@"type";

    if (std.mem.eql(u8, elem_type, "rect")) {
        renderRect(parent, element);
    } else if (std.mem.eql(u8, elem_type, "text")) {
        renderText(parent, element, null);
    } else if (std.mem.eql(u8, elem_type, "input")) {
        renderInput(parent, element);
    } else if (std.mem.eql(u8, elem_type, "image")) {
        renderImage(parent, element);
    }

    // scroll/clip/root 等容器类型：递归渲染子元素
    if (element.children) |children| {
        for (children) |*child| {
            renderElement(parent, child);
        }
    }
}

/// 渲染矩形元素（支持圆角和边框）
fn renderRect(parent: *wlr.SceneTree, element: *const UIElement) void {
    const w: c_int = @intCast(element.width orelse 100);
    const h: c_int = @intCast(element.height orelse 40);
    const color = element.color orelse [4]f32{ 0.2, 0.2, 0.3, 0.9 };
    const px = element.x orelse 0;
    const py = element.y orelse 0;
    const r: c_int = @intCast(element.radius orelse 0);

    if (r > 0) {
        // 圆角矩形：用三个矩形拼接（上下缩进 + 中间全宽）
        // 中间部分（全宽，去掉上下圆角区域）
        if (h > 2 * r) {
            const mid = parent.createSceneRect(w, h - 2 * r, &color) catch return;
            mid.node.setPosition(px, py + r);
        }
        // 上部（缩进左右圆角宽度）
        if (w > 2 * r) {
            const top = parent.createSceneRect(w - 2 * r, r, &color) catch return;
            top.node.setPosition(px + r, py);
        }
        // 下部（缩进左右圆角宽度）
        if (w > 2 * r) {
            const bot = parent.createSceneRect(w - 2 * r, r, &color) catch return;
            bot.node.setPosition(px + r, py + h - r);
        }
    } else {
        // 普通矩形
        const rect = parent.createSceneRect(w, h, &color) catch {
            log.err("KDP: 无法创建矩形节点", .{});
            return;
        };
        rect.node.setPosition(px, py);
    }

    // 边框渲染
    const bw: c_int = @intCast(element.border_width orelse 0);
    if (bw > 0) {
        const bc = element.border_color orelse [4]f32{ 0.165, 0.165, 0.235, 0.5 };
        // 上边
        const top_b = parent.createSceneRect(w, bw, &bc) catch return;
        top_b.node.setPosition(px, py);
        // 下边
        const bot_b = parent.createSceneRect(w, bw, &bc) catch return;
        bot_b.node.setPosition(px, py + h - bw);
        // 左边
        const left_b = parent.createSceneRect(bw, h, &bc) catch return;
        left_b.node.setPosition(px, py);
        // 右边
        const right_b = parent.createSceneRect(bw, h, &bc) catch return;
        right_b.node.setPosition(px + w - bw, py);
    }
}

/// 渲染文本元素（优先使用 FreeType 矢量字体，回退到 8x8 位图字体）
fn renderText(parent: *wlr.SceneTree, element: *const UIElement, display: ?*KairoDisplay) void {
    const text = element.text orelse return;
    const color = element.color orelse [4]f32{ 1.0, 1.0, 1.0, 1.0 };
    const base_x = element.x orelse 0;
    const base_y = element.y orelse 0;

    // 计算目标字号（px）
    const font_size_px: u32 = if (element.font_size) |fs|
        @intCast(@max(8, fs))
    else if (element.scale) |s|
        @intCast(@max(1, s) * 8)
    else
        16; // 默认 16px

    // 尝试 FreeType 矢量渲染
    if (display) |d| {
        if (d.ft_face) |face| {
            if (renderTextFreeType(parent, text, face, font_size_px, base_x, base_y, &color)) {
                return;
            }
        }
    }

    // 回退到位图字体
    const scale: u31 = @intCast(@max(1, @divFloor(font_size_px, 8)));
    const text_tree = parent.createSceneTree() catch return;
    text_tree.node.setPosition(base_x, base_y);

    var cursor_x: c_int = 0;
    for (text) |ch| {
        if (ch < 32 or ch > 126) {
            cursor_x += 8 * @as(c_int, scale);
            continue;
        }
        const glyph = font_8x8[ch - 32];
        renderGlyph(text_tree, glyph, cursor_x, 0, scale, &color);
        cursor_x += 8 * @as(c_int, scale);
    }
}

/// 使用 FreeType 渲染文本（逐字符光栅化为矩形像素块）
/// 返回 true 表示渲染成功
fn renderTextFreeType(
    parent: *wlr.SceneTree,
    text: []const u8,
    face: ft.FT_Face,
    size_px: u32,
    base_x: i32,
    base_y: i32,
    color: *const [4]f32,
) bool {
    // 设置字号
    if (ft.FT_Set_Pixel_Sizes(face, 0, size_px) != 0) return false;

    const text_tree = parent.createSceneTree() catch return false;
    text_tree.node.setPosition(base_x, base_y);

    var pen_x: c_int = 0;
    const ascender: c_int = @intCast(@divFloor(face.*.size.*.metrics.ascender, 64));

    for (text) |ch| {
        if (ch < 32) {
            pen_x += @intCast(@divFloor(size_px, 2));
            continue;
        }

        if (ft.FT_Load_Char(face, ch, ft.FT_LOAD_RENDER) != 0) {
            pen_x += @intCast(@divFloor(size_px, 2));
            continue;
        }

        const glyph = face.*.glyph;
        const bitmap = glyph.*.bitmap;
        const glyph_left: c_int = @intCast(glyph.*.bitmap_left);
        const glyph_top: c_int = @intCast(glyph.*.bitmap_top);

        // 渲染字形位图：将每行连续的非零像素合并为矩形条带
        if (bitmap.buffer != null and bitmap.rows > 0 and bitmap.width > 0) {
            var row: u32 = 0;
            while (row < bitmap.rows) : (row += 1) {
                const pitch: usize = @intCast(bitmap.pitch);
                const row_data = bitmap.buffer[row * pitch .. (row + 1) * pitch];
                var col: u32 = 0;
                while (col < bitmap.width) {
                    if (row_data[col] > 64) { // 阈值过滤低亮度像素
                        const start_col = col;
                        while (col < bitmap.width and row_data[col] > 64) {
                            col += 1;
                        }
                        const run_len: c_int = @intCast(col - start_col);
                        const px = pen_x + glyph_left + @as(c_int, @intCast(start_col));
                        const py = ascender - glyph_top + @as(c_int, @intCast(row));

                        const rect = text_tree.createSceneRect(run_len, 1, color) catch continue;
                        rect.node.setPosition(px, py);
                    } else {
                        col += 1;
                    }
                }
            }
        }

        pen_x += @intCast(@divFloor(glyph.*.advance.x, 64));
    }

    return true;
}

/// 渲染单个字符的位图
fn renderGlyph(
    parent: *wlr.SceneTree,
    glyph: [8]u8,
    ox: c_int,
    oy: c_int,
    scale: u31,
    color: *const [4]f32,
) void {
    // 逐行扫描位图，合并连续像素为水平条带以减少节点数
    for (glyph, 0..) |row, yi| {
        var x: u32 = 0;
        while (x < 8) {
            if (row & (@as(u8, 0x80) >> @as(u3, @intCast(x))) != 0) {
                // 找到连续的 "on" 像素
                const start_x = x;
                while (x < 8 and (row & (@as(u8, 0x80) >> @as(u3, @intCast(x))) != 0)) {
                    x += 1;
                }
                const run_len: c_int = @intCast(x - start_x);
                const px: c_int = ox + @as(c_int, @intCast(start_x)) * @as(c_int, scale);
                const py: c_int = oy + @as(c_int, @intCast(yi)) * @as(c_int, scale);
                const pw: c_int = run_len * @as(c_int, scale);
                const ph: c_int = scale;

                const rect = parent.createSceneRect(pw, ph, color) catch continue;
                rect.node.setPosition(px, py);
            } else {
                x += 1;
            }
        }
    }
}

// ============================================================
// 扩展节点渲染：scroll / clip / input / image
// ============================================================

/// 渲染滚动容器：创建子树并偏移子元素位置模拟滚动
fn renderScroll(parent: *wlr.SceneTree, element: *const UIElement, surface: *KairoSurface, offset_x: i32, offset_y: i32) void {
    const px = (element.x orelse 0) + offset_x;
    const py = (element.y orelse 0) + offset_y;
    const w: c_int = @intCast(element.width orelse 100);
    const h: c_int = @intCast(element.height orelse 100);
    const scroll_offset = element.scroll_offset orelse 0;

    // 渲染滚动区域背景（可选）
    if (element.color) |color| {
        const bg = parent.createSceneRect(w, h, &color) catch return;
        bg.node.setPosition(px, py);
    }

    // 创建子树用于滚动内容（通过偏移 Y 模拟滚动）
    const scroll_tree = parent.createSceneTree() catch return;
    scroll_tree.node.setPosition(px, py - scroll_offset);

    // 递归渲染子元素到滚动子树
    if (element.children) |children| {
        for (children) |*child| {
            renderElementWithHitTest(scroll_tree, child, surface, 0, 0);
        }
    }
}

/// 渲染裁剪容器：超出 width/height 的子节点被裁剪
/// 注意：wlroots scene graph 不直接支持裁剪，这里通过子树 + 背景遮罩近似实现
fn renderClip(parent: *wlr.SceneTree, element: *const UIElement, surface: *KairoSurface, offset_x: i32, offset_y: i32) void {
    const px = (element.x orelse 0) + offset_x;
    const py = (element.y orelse 0) + offset_y;

    // 创建子树
    const clip_tree = parent.createSceneTree() catch return;
    clip_tree.node.setPosition(px, py);

    // 渲染背景（可选）
    if (element.color) |color| {
        const w: c_int = @intCast(element.width orelse 100);
        const h: c_int = @intCast(element.height orelse 100);
        _ = clip_tree.createSceneRect(w, h, &color) catch {};
    }

    // 递归渲染子元素
    if (element.children) |children| {
        for (children) |*child| {
            renderElementWithHitTest(clip_tree, child, surface, 0, 0);
        }
    }
}

/// 渲染输入框：背景 + 文本/占位符 + 光标
fn renderInput(parent: *wlr.SceneTree, element: *const UIElement) void {
    const px = element.x orelse 0;
    const py = element.y orelse 0;
    const w: c_int = @intCast(element.width orelse 200);
    const h: c_int = @intCast(element.height orelse 32);

    // 输入框背景
    const bg_color = element.color orelse [4]f32{ 0.086, 0.086, 0.118, 0.95 };
    const bg = parent.createSceneRect(w, h, &bg_color) catch return;
    bg.node.setPosition(px, py);

    // 边框
    const border_color = if (element.focused orelse false)
        [4]f32{ 0.29, 0.486, 1.0, 0.4 } // 焦点环颜色
    else
        [4]f32{ 0.165, 0.165, 0.235, 0.5 }; // 默认边框
    const bw: c_int = 1;
    const top_b = parent.createSceneRect(w, bw, &border_color) catch return;
    top_b.node.setPosition(px, py);
    const bot_b = parent.createSceneRect(w, bw, &border_color) catch return;
    bot_b.node.setPosition(px, py + h - bw);
    const left_b = parent.createSceneRect(bw, h, &border_color) catch return;
    left_b.node.setPosition(px, py);
    const right_b = parent.createSceneRect(bw, h, &border_color) catch return;
    right_b.node.setPosition(px + w - bw, py);

    // 文本内容或占位符
    const display_text = element.value orelse element.placeholder orelse "";
    const text_color = if (element.value != null)
        [4]f32{ 0.91, 0.91, 0.93, 1.0 } // TEXT_PRIMARY
    else
        [4]f32{ 0.353, 0.353, 0.431, 0.6 }; // TEXT_TERTIARY（占位符）

    if (display_text.len > 0) {
        // 创建临时 UIElement 用于文本渲染
        const text_elem = UIElement{
            .@"type" = "text",
            .x = px + 8,
            .y = py + 8,
            .text = display_text,
            .color = text_color,
            .scale = 2,
        };
        renderText(parent, &text_elem, null);
    }

    // 光标（仅在获得焦点时显示）
    if (element.focused orelse false) {
        const cursor_color = [4]f32{ 0.91, 0.91, 0.93, 1.0 };
        const text_width: c_int = @intCast((element.value orelse "").len * 16); // 8px * scale 2
        const cursor = parent.createSceneRect(2, h - 8, &cursor_color) catch return;
        cursor.node.setPosition(px + 8 + text_width, py + 4);
    }
}

/// 渲染图片节点（占位符实现：显示图标框 + 文件名）
/// 真正的图片渲染需要 wlr_scene_buffer + 图片解码，当前用矩形占位
fn renderImage(parent: *wlr.SceneTree, element: *const UIElement) void {
    const px = element.x orelse 0;
    const py = element.y orelse 0;
    const w: c_int = @intCast(element.width orelse 64);
    const h: c_int = @intCast(element.height orelse 64);

    // 图片占位背景
    const bg_color = element.color orelse [4]f32{ 0.118, 0.118, 0.165, 0.5 };
    const bg = parent.createSceneRect(w, h, &bg_color) catch return;
    bg.node.setPosition(px, py);

    // 占位图标（中心十字）
    const cross_color = [4]f32{ 0.353, 0.353, 0.431, 0.6 };
    const cx = px + @divFloor(w, 2);
    const cy = py + @divFloor(h, 2);
    const cross_h = parent.createSceneRect(16, 2, &cross_color) catch return;
    cross_h.node.setPosition(cx - 8, cy - 1);
    const cross_v = parent.createSceneRect(2, 16, &cross_color) catch return;
    cross_v.node.setPosition(cx - 1, cy - 8);
}

// ============================================================
// 8x8 位图字体数据 (ASCII 32-126, 共 95 个字符)
// 每个字符 8 行，每行 8 位，最高位为最左像素
// ============================================================

const font_8x8: [95][8]u8 = .{
    // 32: Space
    .{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },
    // 33: !
    .{ 0x18, 0x18, 0x18, 0x18, 0x18, 0x00, 0x18, 0x00 },
    // 34: "
    .{ 0x6C, 0x6C, 0x24, 0x00, 0x00, 0x00, 0x00, 0x00 },
    // 35: #
    .{ 0x24, 0x7E, 0x24, 0x24, 0x7E, 0x24, 0x00, 0x00 },
    // 36: $
    .{ 0x18, 0x3E, 0x58, 0x3C, 0x1A, 0x7C, 0x18, 0x00 },
    // 37: %
    .{ 0x62, 0x64, 0x08, 0x10, 0x26, 0x46, 0x00, 0x00 },
    // 38: &
    .{ 0x30, 0x48, 0x30, 0x56, 0x48, 0x34, 0x00, 0x00 },
    // 39: '
    .{ 0x18, 0x18, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00 },
    // 40: (
    .{ 0x08, 0x10, 0x20, 0x20, 0x20, 0x10, 0x08, 0x00 },
    // 41: )
    .{ 0x20, 0x10, 0x08, 0x08, 0x08, 0x10, 0x20, 0x00 },
    // 42: *
    .{ 0x00, 0x24, 0x18, 0x7E, 0x18, 0x24, 0x00, 0x00 },
    // 43: +
    .{ 0x00, 0x18, 0x18, 0x7E, 0x18, 0x18, 0x00, 0x00 },
    // 44: ,
    .{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x10 },
    // 45: -
    .{ 0x00, 0x00, 0x00, 0x7E, 0x00, 0x00, 0x00, 0x00 },
    // 46: .
    .{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x00 },
    // 47: /
    .{ 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x00, 0x00 },
    // 48: 0
    .{ 0x3C, 0x46, 0x4A, 0x52, 0x62, 0x3C, 0x00, 0x00 },
    // 49: 1
    .{ 0x18, 0x38, 0x18, 0x18, 0x18, 0x3C, 0x00, 0x00 },
    // 50: 2
    .{ 0x3C, 0x42, 0x02, 0x1C, 0x20, 0x7E, 0x00, 0x00 },
    // 51: 3
    .{ 0x3C, 0x42, 0x0C, 0x02, 0x42, 0x3C, 0x00, 0x00 },
    // 52: 4
    .{ 0x0C, 0x14, 0x24, 0x7E, 0x04, 0x04, 0x00, 0x00 },
    // 53: 5
    .{ 0x7E, 0x40, 0x7C, 0x02, 0x42, 0x3C, 0x00, 0x00 },
    // 54: 6
    .{ 0x1C, 0x20, 0x7C, 0x42, 0x42, 0x3C, 0x00, 0x00 },
    // 55: 7
    .{ 0x7E, 0x02, 0x04, 0x08, 0x10, 0x10, 0x00, 0x00 },
    // 56: 8
    .{ 0x3C, 0x42, 0x3C, 0x42, 0x42, 0x3C, 0x00, 0x00 },
    // 57: 9
    .{ 0x3C, 0x42, 0x3E, 0x02, 0x04, 0x38, 0x00, 0x00 },
    // 58: :
    .{ 0x00, 0x18, 0x18, 0x00, 0x18, 0x18, 0x00, 0x00 },
    // 59: ;
    .{ 0x00, 0x18, 0x18, 0x00, 0x18, 0x18, 0x10, 0x00 },
    // 60: <
    .{ 0x04, 0x08, 0x10, 0x20, 0x10, 0x08, 0x04, 0x00 },
    // 61: =
    .{ 0x00, 0x00, 0x7E, 0x00, 0x7E, 0x00, 0x00, 0x00 },
    // 62: >
    .{ 0x20, 0x10, 0x08, 0x04, 0x08, 0x10, 0x20, 0x00 },
    // 63: ?
    .{ 0x3C, 0x42, 0x04, 0x08, 0x00, 0x08, 0x00, 0x00 },
    // 64: @
    .{ 0x3C, 0x42, 0x5E, 0x56, 0x5E, 0x40, 0x3C, 0x00 },
    // 65: A
    .{ 0x18, 0x24, 0x42, 0x7E, 0x42, 0x42, 0x00, 0x00 },
    // 66: B
    .{ 0x7C, 0x42, 0x7C, 0x42, 0x42, 0x7C, 0x00, 0x00 },
    // 67: C
    .{ 0x3C, 0x42, 0x40, 0x40, 0x42, 0x3C, 0x00, 0x00 },
    // 68: D
    .{ 0x78, 0x44, 0x42, 0x42, 0x44, 0x78, 0x00, 0x00 },
    // 69: E
    .{ 0x7E, 0x40, 0x7C, 0x40, 0x40, 0x7E, 0x00, 0x00 },
    // 70: F
    .{ 0x7E, 0x40, 0x7C, 0x40, 0x40, 0x40, 0x00, 0x00 },
    // 71: G
    .{ 0x3C, 0x42, 0x40, 0x4E, 0x42, 0x3C, 0x00, 0x00 },
    // 72: H
    .{ 0x42, 0x42, 0x7E, 0x42, 0x42, 0x42, 0x00, 0x00 },
    // 73: I
    .{ 0x3C, 0x18, 0x18, 0x18, 0x18, 0x3C, 0x00, 0x00 },
    // 74: J
    .{ 0x1E, 0x04, 0x04, 0x04, 0x44, 0x38, 0x00, 0x00 },
    // 75: K
    .{ 0x44, 0x48, 0x70, 0x48, 0x44, 0x42, 0x00, 0x00 },
    // 76: L
    .{ 0x40, 0x40, 0x40, 0x40, 0x40, 0x7E, 0x00, 0x00 },
    // 77: M
    .{ 0x42, 0x66, 0x5A, 0x42, 0x42, 0x42, 0x00, 0x00 },
    // 78: N
    .{ 0x42, 0x62, 0x52, 0x4A, 0x46, 0x42, 0x00, 0x00 },
    // 79: O
    .{ 0x3C, 0x42, 0x42, 0x42, 0x42, 0x3C, 0x00, 0x00 },
    // 80: P
    .{ 0x7C, 0x42, 0x42, 0x7C, 0x40, 0x40, 0x00, 0x00 },
    // 81: Q
    .{ 0x3C, 0x42, 0x42, 0x4A, 0x44, 0x3A, 0x00, 0x00 },
    // 82: R
    .{ 0x7C, 0x42, 0x42, 0x7C, 0x44, 0x42, 0x00, 0x00 },
    // 83: S
    .{ 0x3C, 0x40, 0x3C, 0x02, 0x42, 0x3C, 0x00, 0x00 },
    // 84: T
    .{ 0x7E, 0x18, 0x18, 0x18, 0x18, 0x18, 0x00, 0x00 },
    // 85: U
    .{ 0x42, 0x42, 0x42, 0x42, 0x42, 0x3C, 0x00, 0x00 },
    // 86: V
    .{ 0x42, 0x42, 0x42, 0x24, 0x24, 0x18, 0x00, 0x00 },
    // 87: W
    .{ 0x42, 0x42, 0x42, 0x5A, 0x66, 0x42, 0x00, 0x00 },
    // 88: X
    .{ 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x00, 0x00 },
    // 89: Y
    .{ 0x42, 0x24, 0x18, 0x18, 0x18, 0x18, 0x00, 0x00 },
    // 90: Z
    .{ 0x7E, 0x04, 0x08, 0x10, 0x20, 0x7E, 0x00, 0x00 },
    // 91: [
    .{ 0x38, 0x20, 0x20, 0x20, 0x20, 0x20, 0x38, 0x00 },
    // 92: backslash
    .{ 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x00, 0x00 },
    // 93: ]
    .{ 0x1C, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1C, 0x00 },
    // 94: ^
    .{ 0x10, 0x28, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00 },
    // 95: _
    .{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7E, 0x00 },
    // 96: `
    .{ 0x20, 0x10, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00 },
    // 97: a
    .{ 0x00, 0x00, 0x3C, 0x02, 0x3E, 0x42, 0x3E, 0x00 },
    // 98: b
    .{ 0x40, 0x40, 0x5C, 0x62, 0x42, 0x62, 0x5C, 0x00 },
    // 99: c
    .{ 0x00, 0x00, 0x3C, 0x42, 0x40, 0x42, 0x3C, 0x00 },
    // 100: d
    .{ 0x02, 0x02, 0x3A, 0x46, 0x42, 0x46, 0x3A, 0x00 },
    // 101: e
    .{ 0x00, 0x00, 0x3C, 0x42, 0x7E, 0x40, 0x3C, 0x00 },
    // 102: f
    .{ 0x0C, 0x12, 0x10, 0x3C, 0x10, 0x10, 0x10, 0x00 },
    // 103: g
    .{ 0x00, 0x00, 0x3A, 0x46, 0x46, 0x3A, 0x02, 0x3C },
    // 104: h
    .{ 0x40, 0x40, 0x5C, 0x62, 0x42, 0x42, 0x42, 0x00 },
    // 105: i
    .{ 0x18, 0x00, 0x38, 0x18, 0x18, 0x18, 0x3C, 0x00 },
    // 106: j
    .{ 0x04, 0x00, 0x04, 0x04, 0x04, 0x44, 0x38, 0x00 },
    // 107: k
    .{ 0x40, 0x40, 0x44, 0x48, 0x70, 0x48, 0x44, 0x00 },
    // 108: l
    .{ 0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3C, 0x00 },
    // 109: m
    .{ 0x00, 0x00, 0x76, 0x49, 0x49, 0x49, 0x49, 0x00 },
    // 110: n
    .{ 0x00, 0x00, 0x5C, 0x62, 0x42, 0x42, 0x42, 0x00 },
    // 111: o
    .{ 0x00, 0x00, 0x3C, 0x42, 0x42, 0x42, 0x3C, 0x00 },
    // 112: p
    .{ 0x00, 0x00, 0x5C, 0x62, 0x62, 0x5C, 0x40, 0x40 },
    // 113: q
    .{ 0x00, 0x00, 0x3A, 0x46, 0x46, 0x3A, 0x02, 0x02 },
    // 114: r
    .{ 0x00, 0x00, 0x5C, 0x62, 0x40, 0x40, 0x40, 0x00 },
    // 115: s
    .{ 0x00, 0x00, 0x3E, 0x40, 0x3C, 0x02, 0x7C, 0x00 },
    // 116: t
    .{ 0x10, 0x10, 0x3C, 0x10, 0x10, 0x12, 0x0C, 0x00 },
    // 117: u
    .{ 0x00, 0x00, 0x42, 0x42, 0x42, 0x46, 0x3A, 0x00 },
    // 118: v
    .{ 0x00, 0x00, 0x42, 0x42, 0x24, 0x24, 0x18, 0x00 },
    // 119: w
    .{ 0x00, 0x00, 0x41, 0x49, 0x49, 0x49, 0x36, 0x00 },
    // 120: x
    .{ 0x00, 0x00, 0x42, 0x24, 0x18, 0x24, 0x42, 0x00 },
    // 121: y
    .{ 0x00, 0x00, 0x42, 0x42, 0x46, 0x3A, 0x02, 0x3C },
    // 122: z
    .{ 0x00, 0x00, 0x7E, 0x04, 0x18, 0x20, 0x7E, 0x00 },
    // 123: {
    .{ 0x0C, 0x10, 0x10, 0x20, 0x10, 0x10, 0x0C, 0x00 },
    // 124: |
    .{ 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x00 },
    // 125: }
    .{ 0x30, 0x08, 0x08, 0x04, 0x08, 0x08, 0x30, 0x00 },
    // 126: ~
    .{ 0x00, 0x00, 0x32, 0x4C, 0x00, 0x00, 0x00, 0x00 },
};
