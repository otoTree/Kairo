// 消息列表渲染 + 滚动
const std = @import("std");
const draw = @import("draw");
const colors = @import("colors");
const TextRenderer = @import("text_render").TextRenderer;

pub const Role = enum { user, agent };

pub const ChatMessage = struct {
    role: Role,
    text: []const u8, // 由 allocator 分配
};

const BUBBLE_H: i32 = 32;
const BUBBLE_PAD: i32 = 12;
const BUBBLE_GAP: i32 = 8;
const FONT_SIZE: u32 = 16;
const MAX_BUBBLE_W: i32 = 400;

pub const MessageList = struct {
    messages: std.ArrayList(ChatMessage),
    scroll_offset: i32 = 0,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) MessageList {
        return .{
            .messages = .{},
            .allocator = allocator,
        };
    }

    /// 添加消息（复制文本）
    pub fn addMessage(self: *MessageList, role: Role, text: []const u8) !void {
        const text_copy = try self.allocator.dupe(u8, text);
        try self.messages.append(self.allocator, .{ .role = role, .text = text_copy });
        // 自动滚动到底部
        self.scrollToBottom();
    }

    /// 滚动（delta > 0 向下，< 0 向上）
    pub fn scroll(self: *MessageList, delta: i32) void {
        self.scroll_offset = @max(0, self.scroll_offset + delta);
    }

    fn scrollToBottom(self: *MessageList) void {
        const total_h = self.totalHeight();
        if (total_h > 0) {
            self.scroll_offset = @max(0, total_h - 300); // 大致可见区域高度
        }
    }

    fn totalHeight(self: *MessageList) i32 {
        const count: i32 = @intCast(self.messages.items.len);
        return count * (BUBBLE_H + BUBBLE_GAP);
    }

    /// 渲染消息列表到像素缓冲区的指定区域
    pub fn render(
        self: *MessageList,
        text_renderer: *TextRenderer,
        buf: [*]u32,
        buf_w: u32,
        buf_h: u32,
        area_x: i32,
        area_y: i32,
        area_w: i32,
        area_h: i32,
    ) void {
        // 消息区域背景
        draw.fillRect(buf, buf_w, buf_h, area_x, area_y, area_w, area_h, colors.BG_BASE);

        var y_pos: i32 = area_y + BUBBLE_GAP - self.scroll_offset;

        for (self.messages.items) |msg| {
            // 跳过不可见的消息
            if (y_pos + BUBBLE_H < area_y) {
                y_pos += BUBBLE_H + BUBBLE_GAP;
                continue;
            }
            if (y_pos > area_y + area_h) break;

            // 估算气泡宽度
            const text_w: i32 = @intCast(text_renderer.measureText(msg.text, FONT_SIZE));
            const bubble_w = @min(text_w + 2 * BUBBLE_PAD, MAX_BUBBLE_W);

            const is_user = msg.role == .user;
            const bubble_x = if (is_user)
                area_x + area_w - 16 - bubble_w // 用户消息靠右
            else
                area_x + 16; // Agent 消息靠左

            const bg_color = if (is_user) colors.BRAND_BLUE else colors.BG_ELEVATED;
            const text_color = if (is_user) colors.TEXT_PRIMARY else colors.ACCENT_TEAL;

            // 绘制气泡
            draw.fillRoundRect(buf, buf_w, buf_h, bubble_x, y_pos, bubble_w, BUBBLE_H, 8, bg_color);

            // 绘制文字
            text_renderer.renderText(
                buf, buf_w, buf_h,
                bubble_x + BUBBLE_PAD,
                y_pos + 8,
                msg.text,
                text_color,
                FONT_SIZE,
            );

            y_pos += BUBBLE_H + BUBBLE_GAP;
        }
    }

    pub fn deinit(self: *MessageList) void {
        for (self.messages.items) |msg| {
            self.allocator.free(msg.text);
        }
        self.messages.deinit(self.allocator);
    }
};
