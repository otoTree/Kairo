// kairo-brand — 品牌展示应用（原生 Wayland 客户端）
// 对标 src/domains/ui/windows/brand.ts 的布局
const std = @import("std");
const posix = std.posix;
const wl_client = @import("wayland_client");
const draw = @import("draw");
const colors = @import("colors");
const TextRenderer = @import("text_render").TextRenderer;
const ipc = @import("ipc_client");

const BRAND_WIDTH: u32 = 480;
const BRAND_HEIGHT: u32 = 560;

// 系统状态数据
const SystemState = struct {
    agent_status: []const u8 = "ready",
    memory_used_mb: u64 = 0,
    memory_total_mb: u64 = 0,
    uptime_seconds: u64 = 0,
};

// 全局状态（通过 App.user_data 传递）
const BrandState = struct {
    text: TextRenderer,
    ipc_client: ?ipc.Client = null,
    system: SystemState = .{},
    start_time: i64,
    allocator: std.mem.Allocator,
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // 初始化文字渲染器
    var text = TextRenderer.init() catch {
        std.debug.print("kairo-brand: 字体初始化失败\n", .{});
        return;
    };
    defer text.deinit();

    // 连接内核 IPC
    var ipc_client = ipc.Client.connect(allocator, ipc.SOCKET_PATH) catch |err| {
        std.debug.print("kairo-brand: IPC 连接失败: {}\n", .{err});
        return;
    };

    var state = BrandState{
        .text = text,
        .ipc_client = ipc_client,
        .start_time = std.time.timestamp(),
        .allocator = allocator,
    };

    // 初始化 Wayland 窗口（堆分配，地址稳定）
    var app = wl_client.App.create(allocator, "Kairo", BRAND_WIDTH, BRAND_HEIGHT) catch |err| {
        std.debug.print("kairo-brand: Wayland 初始化失败: {}\n", .{err});
        return;
    };
    defer app.destroy();

    app.user_data = @ptrCast(&state);
    app.on_draw = onDraw;
    app.on_click = onClick;

    // 事件循环：Wayland fd + IPC fd，2 秒超时刷新系统状态
    const ipc_fd = ipc_client.getFd();
    app.runWithExtraFd(ipc_fd, onIpcData, 2000) catch |err| {
        std.debug.print("kairo-brand: 事件循环错误: {}\n", .{err});
    };

    if (state.ipc_client) |*c| c.close();
}

/// 绘制回调 — 渲染品牌窗口完整 UI
fn onDraw(app: *wl_client.App) void {
    const state: *BrandState = @ptrCast(@alignCast(app.user_data.?));
    const buf = app.getPixelBuffer();
    const w = app.width;
    const h = app.height;

    // 背景
    draw.fillRect(buf, w, h, 0, 0, @intCast(w), @intCast(h), colors.BG_BASE);

    // 关闭按钮 (452, 10, 16×16)
    draw.fillRect(buf, w, h, 452, 10, 16, 16, colors.TEXT_SECONDARY);

    // Logo "<>" (220, 180)
    state.text.renderText(buf, w, h, 220, 180, "<>", colors.BRAND_BLUE, 32);

    // 品牌名 "K A I R O" (184, 228)
    state.text.renderText(buf, w, h, 184, 228, "K A I R O", colors.TEXT_PRIMARY, 32);

    // 副标题 "Agent-Native OS" (176, 268)
    state.text.renderText(buf, w, h, 176, 268, "Agent-Native OS", colors.TEXT_SECONDARY, 16);

    // 分隔线 (180, 300, 120×1)
    draw.drawHLine(buf, w, h, 180, 300, 120, colors.BORDER);

    // 终端卡片 (88, 324, 140×72)
    draw.fillRoundRect(buf, w, h, 88, 324, 140, 72, 8, colors.BG_ELEVATED);
    state.text.renderText(buf, w, h, 100, 340, ">_", colors.BRAND_BLUE, 16);
    state.text.renderText(buf, w, h, 100, 368, "Terminal", colors.TEXT_PRIMARY, 16);

    // 文件卡片 (252, 324, 140×72)
    draw.fillRoundRect(buf, w, h, 252, 324, 140, 72, 8, colors.BG_ELEVATED);
    state.text.renderText(buf, w, h, 264, 340, "[]", colors.BRAND_BLUE, 16);
    state.text.renderText(buf, w, h, 264, 368, "Files", colors.TEXT_PRIMARY, 16);

    // 系统状态面板 (100, 420, 280×96)
    draw.fillRoundRect(buf, w, h, 100, 420, 280, 96, 8, colors.BG_ELEVATED);
    state.text.renderText(buf, w, h, 112, 432, "System Status", colors.TEXT_SECONDARY, 8);

    // Agent 状态
    state.text.renderText(buf, w, h, 112, 452, "Agent: ", colors.TEXT_PRIMARY, 16);
    state.text.renderText(buf, w, h, 200, 452, state.system.agent_status, colors.SEMANTIC_SUCCESS, 16);

    // 内存状态
    var mem_buf: [64]u8 = undefined;
    const mem_text = std.fmt.bufPrint(&mem_buf, "Memory: {d} MB / {d} MB", .{
        state.system.memory_used_mb,
        state.system.memory_total_mb,
    }) catch "Memory: -- MB";
    state.text.renderText(buf, w, h, 112, 474, mem_text, colors.TEXT_PRIMARY, 16);

    // 运行时间
    const uptime = @as(u64, @intCast(std.time.timestamp() - state.start_time));
    var uptime_buf: [32]u8 = undefined;
    const uptime_text = std.fmt.bufPrint(&uptime_buf, "Uptime: {d:0>2}:{d:0>2}:{d:0>2}", .{
        uptime / 3600,
        (uptime % 3600) / 60,
        uptime % 60,
    }) catch "Uptime: --:--:--";
    state.text.renderText(buf, w, h, 112, 496, uptime_text, colors.TEXT_PRIMARY, 16);

    // 版本号 (196, 536)
    state.text.renderText(buf, w, h, 196, 536, "v0.1.0-alpha", colors.TEXT_TERTIARY, 8);
}

/// 鼠标点击回调
fn onClick(app: *wl_client.App, x: i32, y: i32, _: u32) void {
    const state: *BrandState = @ptrCast(@alignCast(app.user_data.?));

    // 关闭按钮 (452, 10, 16×16)
    if (x >= 452 and x < 468 and y >= 10 and y < 26) {
        app.running = false;
        return;
    }

    // 终端卡片 (88, 324, 140×72)
    if (x >= 88 and x < 228 and y >= 324 and y < 396) {
        spawnApp(state.allocator, &.{"foot"});
        return;
    }

    // 文件卡片 (252, 324, 140×72)
    if (x >= 252 and x < 392 and y >= 324 and y < 396) {
        spawnApp(state.allocator, &.{"thunar"});
        return;
    }
}

/// IPC 数据回调 — 读取系统状态响应
fn onIpcData(app: *wl_client.App) void {
    const state: *BrandState = @ptrCast(@alignCast(app.user_data.?));
    if (state.ipc_client) |*client| {
        if (client.readPacket(state.allocator)) |packet_opt| {
            if (packet_opt) |packet| {
                defer state.allocator.free(packet.payload);
                // 尝试解析系统指标
                if (ipc.findUintValue(packet.payload, "memory_used")) |v| {
                    state.system.memory_used_mb = v;
                }
                if (ipc.findUintValue(packet.payload, "memory_total")) |v| {
                    state.system.memory_total_mb = v;
                }
                app.requestRedraw();
            }
        } else |_| {
            // IPC 读取错误，关闭连接
            client.close();
            state.ipc_client = null;
        }
    }

    // 发送下一次状态请求
    if (state.ipc_client) |*client| {
        client.sendRequest("brand-metrics", "system.get_metrics") catch {};
    }
}

/// 启动外部应用
fn spawnApp(allocator: std.mem.Allocator, argv: []const []const u8) void {
    var child = std.process.Child.init(argv, allocator);
    child.spawn() catch |err| {
        std.debug.print("kairo-brand: 启动应用失败: {}\n", .{err});
        return;
    };
    std.debug.print("kairo-brand: 已启动应用 (pid={})\n", .{child.id});
}
