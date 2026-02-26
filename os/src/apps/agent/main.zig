// kairo-agent-ui — Agent 窗口应用（原生 Wayland 客户端）
// 对标 src/domains/ui/windows/agent-window.ts
const std = @import("std");
const posix = std.posix;
const wl_client = @import("wayland_client");
const draw = @import("draw");
const colors = @import("colors");
const TextRenderer = @import("text_render").TextRenderer;
const WebSocket = @import("websocket.zig").WebSocket;
const Opcode = @import("websocket.zig").Opcode;
const MessageList = @import("message_list.zig").MessageList;
const Role = @import("message_list.zig").Role;

const AGENT_WIDTH: u32 = 600;
const AGENT_HEIGHT: u32 = 500;
const TITLEBAR_H: i32 = 36;
const INPUT_AREA_H: i32 = 48;
const STATUSBAR_H: i32 = 28;
const MSG_AREA_Y: i32 = TITLEBAR_H;
const MSG_AREA_H: i32 = @as(i32, AGENT_HEIGHT) - TITLEBAR_H - INPUT_AREA_H - STATUSBAR_H;

const AgentState = struct {
    text: TextRenderer,
    ws: ?WebSocket = null,
    messages: MessageList,
    input_buf: [256]u8 = undefined,
    input_len: usize = 0,
    agent_status: []const u8 = "Connecting...",
    allocator: std.mem.Allocator,
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var text = TextRenderer.init() catch {
        std.debug.print("kairo-agent-ui: 字体初始化失败\n", .{});
        return;
    };
    defer text.deinit();

    // 读取 WebSocket token，构造 /ws?token=xxx 路径
    var ws_path_buf: [320]u8 = undefined;
    const ws_path: []const u8 = blk: {
        const token_file = std.fs.cwd().openFile("/run/kairo/ws.token", .{}) catch {
            std.debug.print("kairo-agent-ui: 无法读取 token 文件，尝试无认证连接\n", .{});
            break :blk "/ws";
        };
        defer token_file.close();
        const prefix = "/ws?token=";
        @memcpy(ws_path_buf[0..prefix.len], prefix);
        const token_len = token_file.readAll(ws_path_buf[prefix.len..]) catch {
            break :blk "/ws";
        };
        // 去除尾部空白
        var end = token_len;
        while (end > 0 and (ws_path_buf[prefix.len + end - 1] == '\n' or ws_path_buf[prefix.len + end - 1] == '\r' or ws_path_buf[prefix.len + end - 1] == ' ')) end -= 1;
        if (end == 0) break :blk "/ws";
        break :blk ws_path_buf[0 .. prefix.len + end];
    };

    // 连接 WebSocket
    var ws = WebSocket.connect(allocator, "127.0.0.1", 3000, ws_path) catch |err| {
        std.debug.print("kairo-agent-ui: WebSocket 连接失败: {}\n", .{err});
        return;
    };

    var messages = MessageList.init(allocator);
    defer messages.deinit();

    // 添加欢迎消息
    try messages.addMessage(.agent, "Hello! I'm Kairo Agent.");
    try messages.addMessage(.agent, "How can I help you today?");

    var state = AgentState{
        .text = text,
        .ws = ws,
        .messages = messages,
        .agent_status = "Agent Ready",
        .allocator = allocator,
    };

    var app = wl_client.App.create(allocator, "Kairo Agent", AGENT_WIDTH, AGENT_HEIGHT) catch |err| {
        std.debug.print("kairo-agent-ui: Wayland 初始化失败: {}\n", .{err});
        return;
    };
    defer app.destroy();

    app.user_data = @ptrCast(&state);
    app.on_draw = onDraw;
    app.on_click = onClick;
    app.on_key = onKey;
    app.on_scroll = onScroll;

    const ws_fd = ws.getFd();
    app.runWithExtraFd(ws_fd, onWsData, -1) catch |err| {
        std.debug.print("kairo-agent-ui: 事件循环错误: {}\n", .{err});
    };

    if (state.ws) |*w| {
        w.sendClose() catch {};
        w.close();
    }
}

/// 绘制回调
fn onDraw(app: *wl_client.App) void {
    const state: *AgentState = @ptrCast(@alignCast(app.user_data.?));
    const buf = app.getPixelBuffer();
    const w = app.width;
    const h = app.height;

    // 背景
    draw.fillRect(buf, w, h, 0, 0, @intCast(w), @intCast(h), colors.BG_BASE);

    // 标题栏 (0, 0, 600×36)
    draw.fillRect(buf, w, h, 0, 0, @intCast(w), TITLEBAR_H, colors.BG_SURFACE);
    state.text.renderText(buf, w, h, 12, 10, "Kairo Agent", colors.TEXT_PRIMARY, 16);

    // 关闭按钮 (572, 10, 16×16)
    draw.fillRect(buf, w, h, 572, 10, 16, 16, colors.TEXT_SECONDARY);

    // 消息列表区域
    state.messages.render(
        &state.text, buf, w, h,
        0, MSG_AREA_Y, @intCast(w), MSG_AREA_H,
    );

    // 输入分隔线
    const input_y: i32 = @as(i32, @intCast(h)) - INPUT_AREA_H - STATUSBAR_H;
    draw.drawHLine(buf, w, h, 0, input_y, @intCast(w), colors.DIVIDER);

    // 输入区域背景
    draw.fillRect(buf, w, h, 0, input_y + 1, @intCast(w), INPUT_AREA_H - 1, colors.BG_SURFACE);

    // Agent 状态指示灯 (12, inputY+18, 8×8)
    draw.fillRoundRect(buf, w, h, 12, input_y + 18, 8, 8, 4, colors.SEMANTIC_SUCCESS);

    // 输入框背景 (28, inputY+8, 500×28)
    draw.fillRoundRect(buf, w, h, 28, input_y + 8, 500, 28, 4, colors.BG_ELEVATED);

    // 输入文字
    if (state.input_len > 0) {
        state.text.renderText(buf, w, h, 36, input_y + 14, state.input_buf[0..state.input_len], colors.TEXT_PRIMARY, 16);
    } else {
        state.text.renderText(buf, w, h, 36, input_y + 14, "Type a message...", colors.TEXT_TERTIARY, 16);
    }

    // 发送按钮 (536, inputY+8, 52×28)
    draw.fillRoundRect(buf, w, h, 536, input_y + 8, 52, 28, 4, colors.BRAND_BLUE);
    state.text.renderText(buf, w, h, 548, input_y + 14, "Send", colors.TEXT_PRIMARY, 12);

    // 状态栏
    const status_y: i32 = @as(i32, @intCast(h)) - STATUSBAR_H;
    draw.fillRect(buf, w, h, 0, status_y, @intCast(w), STATUSBAR_H, colors.BG_SURFACE);
    state.text.renderText(buf, w, h, 12, status_y + 8, state.agent_status, colors.TEXT_SECONDARY, 12);
    state.text.renderText(buf, w, h, 504, status_y + 8, "Kairo v0.1.0", colors.TEXT_SECONDARY, 12);
}

/// 鼠标点击
fn onClick(app: *wl_client.App, x: i32, y: i32, _: u32) void {
    const state: *AgentState = @ptrCast(@alignCast(app.user_data.?));

    // 关闭按钮 (572, 10, 16×16)
    if (x >= 572 and x < 588 and y >= 10 and y < 26) {
        app.running = false;
        return;
    }

    // 发送按钮 (536, inputY+8, 52×28)
    const input_y: i32 = @as(i32, @intCast(app.height)) - INPUT_AREA_H - STATUSBAR_H;
    if (x >= 536 and x < 588 and y >= input_y + 8 and y < input_y + 36) {
        sendMessage(app, state);
        return;
    }
}

/// 键盘输入
fn onKey(app: *wl_client.App, key: u32, key_state: u32) void {
    if (key_state != 1) return; // 仅处理按下事件
    const state: *AgentState = @ptrCast(@alignCast(app.user_data.?));

    // Linux evdev keycode 映射（简化版 ASCII）
    const ascii = evdevToAscii(key);
    if (ascii > 0) {
        if (state.input_len < state.input_buf.len - 1) {
            state.input_buf[state.input_len] = ascii;
            state.input_len += 1;
            app.requestRedraw();
        }
        return;
    }

    switch (key) {
        14 => { // Backspace
            if (state.input_len > 0) {
                state.input_len -= 1;
                app.requestRedraw();
            }
        },
        28 => { // Enter
            sendMessage(app, state);
        },
        else => {},
    }
}

/// 鼠标滚轮
fn onScroll(app: *wl_client.App, _: u32, value: i32) void {
    const state: *AgentState = @ptrCast(@alignCast(app.user_data.?));
    state.messages.scroll(value * 20);
    app.requestRedraw();
}

/// WebSocket 数据回调
fn onWsData(app: *wl_client.App) void {
    const state: *AgentState = @ptrCast(@alignCast(app.user_data.?));
    if (state.ws) |*ws| {
        const frame = ws.readFrame() catch {
            state.ws = null;
            state.agent_status = "Disconnected";
            app.requestRedraw();
            return;
        };
        if (frame) |f| {
            switch (f.opcode) {
                .text => {
                    // 尝试提取消息文本（简化 JSON 解析）
                    const text = extractJsonText(f.payload) orelse f.payload;
                    state.messages.addMessage(.agent, text) catch {};
                    state.agent_status = "Agent Ready";
                    app.requestRedraw();
                },
                .close => {
                    state.ws = null;
                    state.agent_status = "Disconnected";
                    app.running = false;
                },
                else => {},
            }
        }
    }
}

/// 发送用户消息
fn sendMessage(app: *wl_client.App, state: *AgentState) void {
    if (state.input_len == 0) return;
    const text = state.input_buf[0..state.input_len];

    // 添加到消息列表
    state.messages.addMessage(.user, text) catch return;
    state.agent_status = "Agent Thinking...";

    // 通过 WebSocket 发送
    if (state.ws) |*ws| {
        var json_buf: [512]u8 = undefined;
        const json = std.fmt.bufPrint(&json_buf,
            "{{\"type\":\"user_message\",\"text\":\"{s}\"}}",
            .{text},
        ) catch return;
        ws.sendText(json) catch {};
    }

    state.input_len = 0;
    app.requestRedraw();
}

/// 简化 JSON 文本提取：查找 "text":"..." 或 "content":"..."
fn extractJsonText(payload: []const u8) ?[]const u8 {
    // 查找 "text":" 或 "content":"
    const markers = [_][]const u8{ "\"text\":\"", "\"content\":\"" };
    for (markers) |marker| {
        if (std.mem.indexOf(u8, payload, marker)) |idx| {
            const start = idx + marker.len;
            if (start >= payload.len) continue;
            // 查找结束引号
            if (std.mem.indexOfScalar(u8, payload[start..], '"')) |end| {
                return payload[start .. start + end];
            }
        }
    }
    return null;
}

/// evdev keycode → ASCII（简化映射，仅基本字符）
fn evdevToAscii(key: u32) u8 {
    return switch (key) {
        2 => '1', 3 => '2', 4 => '3', 5 => '4', 6 => '5',
        7 => '6', 8 => '7', 9 => '8', 10 => '9', 11 => '0',
        16 => 'q', 17 => 'w', 18 => 'e', 19 => 'r', 20 => 't',
        21 => 'y', 22 => 'u', 23 => 'i', 24 => 'o', 25 => 'p',
        30 => 'a', 31 => 's', 32 => 'd', 33 => 'f', 34 => 'g',
        35 => 'h', 36 => 'j', 37 => 'k', 38 => 'l',
        44 => 'z', 45 => 'x', 46 => 'c', 47 => 'v', 48 => 'b',
        49 => 'n', 50 => 'm',
        57 => ' ', // Space
        12 => '-', 13 => '=',
        26 => '[', 27 => ']',
        39 => ';', 40 => '\'',
        51 => ',', 52 => '.', 53 => '/',
        else => 0,
    };
}
