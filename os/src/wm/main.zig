const std = @import("std");
const wayland = @import("wayland");
const wl = wayland.client.wl;
const river = wayland.client.river;
const kairo = wayland.client.kairo;
const ipc = @import("ipc.zig");

// ============================================================
// 数据结构
// ============================================================

/// xdg-shell 窗口（Chromium 等传统应用）
const Window = struct {
    river_window: *river.WindowV1,
    node: ?*river.NodeV1,
    width: u32 = 0,
    height: u32 = 0,
    /// 窗口标题（从 river_window_v1.title 事件获取）
    title: ?[]const u8 = null,
    /// 是否已请求 SSD
    ssd_requested: bool = false,
    /// 装饰偏好（从 decoration_hint 事件获取）
    decoration_hint: u32 = 2, // 默认 prefers_ssd
    /// 是否已最大化
    maximized: bool = false,
    /// 是否已最小化（隐藏）
    minimized: bool = false,
};

/// KDP 窗口（通过 river_shell_surface 参与 WM 布局）
const KdpWindow = struct {
    wl_surface: *wl.Surface,
    shell_surface: *river.ShellSurfaceV1,
    kairo_surface: *kairo.SurfaceV1,
    node: ?*river.NodeV1,
    title: []const u8,
    width: i32 = 480,
    height: i32 = 560,
    /// 是否已最大化
    maximized: bool = false,
    /// 是否已最小化（隐藏）
    minimized: bool = false,
    /// 上下文引用（用于事件回调）
    ctx: ?*Context = null,
};

const Output = struct {
    river_output: *river.OutputV1,
    width: i32,
    height: i32,
};

const Seat = struct {
    river_seat: *river.SeatV1,
};

/// 统一焦点目标：xdg 窗口或 KDP shell surface
const FocusTarget = union(enum) {
    window: *river.WindowV1,
    shell_surface: *river.ShellSurfaceV1,
};

const Context = struct {
    wm_global: ?*river.WindowManagerV1,
    compositor_global: ?*wl.Compositor,
    shm_global: ?*wl.Shm,
    kairo_display: ?*kairo.DisplayV1,

    windows: std.ArrayList(*Window),
    kdp_windows: std.ArrayList(*KdpWindow),
    outputs: std.ArrayList(*Output),
    seats: std.ArrayList(*Seat),
    allocator: std.mem.Allocator,
    agent_active: bool = false,
    /// 待聚焦目标（在下一次 manage_start 时应用）
    pending_focus: ?FocusTarget = null,
    /// 当前已聚焦目标
    focused: ?FocusTarget = null,
    /// IPC 客户端引用（用于发送窗口列表事件）
    ipc_client: ?*ipc.Client = null,
    /// 焦点循环索引（Alt+Tab 用）
    focus_cycle_index: usize = 0,
    /// 启动器是否可见
    launcher_visible: bool = false,
    /// 是否在 manage 序列中（用于判断何时可以修改 WM 状态）
    in_manage_sequence: bool = false,
    /// 是否在 render 序列中
    in_render_sequence: bool = false,
};

// ============================================================
// 事件监听器
// ============================================================

fn windowListener(window: *river.WindowV1, event: river.WindowV1.Event, ctx: *Window) void {
    _ = window;
    switch (event) {
        .dimensions => |ev| {
            ctx.width = @intCast(ev.width);
            ctx.height = @intCast(ev.height);
        },
        .title => |ev| {
            ctx.title = if (ev.title) |t| std.mem.span(t) else null;
        },
        .decoration_hint => |ev| {
            ctx.decoration_hint = @intCast(@intFromEnum(ev.hint));
            std.debug.print("WM: window decoration_hint = {}\n", .{ev.hint});
        },
        .closed => {},
        else => {},
    }
}

/// KDP surface 事件监听器：处理桌面图标点击等 user_action 事件
fn kairoSurfaceListener(surface: *kairo.SurfaceV1, event: kairo.SurfaceV1.Event, kdp_win: *KdpWindow) void {
    _ = surface;
    switch (event) {
        .user_action => |ev| {
            const element_id = std.mem.span(ev.element_id);
            const action_type = std.mem.span(ev.action_type);
            std.debug.print("KDP user_action: element={s} action={s}\n", .{ element_id, action_type });

            // 处理桌面图标点击 → 提取纯净 appId 并启动对应窗口
            if (std.mem.startsWith(u8, element_id, "desktop-icon-") and std.mem.eql(u8, action_type, "click")) {
                var raw_id = element_id["desktop-icon-".len..];
                // 去除 symbol- / label- 前缀，提取纯净 appId
                if (std.mem.startsWith(u8, raw_id, "symbol-")) {
                    raw_id = raw_id["symbol-".len..];
                } else if (std.mem.startsWith(u8, raw_id, "label-")) {
                    raw_id = raw_id["label-".len..];
                }
                std.debug.print("Desktop icon clicked: {s}\n", .{raw_id});

                // 直接在 WM 中创建对应窗口
                if (kdp_win.ctx) |ctx| {
                    var buf: [256]u8 = undefined;
                    const payload = std.fmt.bufPrint(&buf, "desktop.launch_app:{s}", .{raw_id}) catch return;
                    const packet = ipc.Client.Packet{
                        .type = .EVENT,
                        .payload = payload,
                    };
                    handleIpcCommand(ctx, packet);
                }
            }

            // 处理窗口关闭按钮
            if (std.mem.eql(u8, element_id, "btn_close") or std.mem.eql(u8, element_id, "btn-close")) {
                std.debug.print("Close button clicked on KDP window\n", .{});
                if (kdp_win.ctx) |ctx| {
                    closeKdpWindow(ctx, kdp_win);
                }
            }
        },
        .key_event => |ev| {
            // 将键盘事件通过 IPC 转发给内核（供 TypeScript 终端控制器处理）
            if (kdp_win.ctx) |ctx| {
                std.debug.print("KDP key_event: key={} state={} mods={} on '{s}'\n", .{ ev.key, ev.state, ev.modifiers, kdp_win.title });
                forwardKeyEvent(ctx, kdp_win.title, ev.key, ev.state, ev.modifiers);
            }
        },
        .pointer_event => {},
        .focus_event => {},
        else => {},
    }
}

fn outputListener(output: *river.OutputV1, event: river.OutputV1.Event, ctx: *Output) void {
    _ = output;
    switch (event) {
        .dimensions => |ev| {
            ctx.width = ev.width;
            ctx.height = ev.height;
        },
        .removed => {},
        else => {},
    }
}

fn seatListener(seat: *river.SeatV1, event: river.SeatV1.Event, ctx: *Context) void {
    _ = seat;
    switch (event) {
        .pointer_enter => |ev| {
            // 鼠标进入 xdg 窗口区域
            if (ev.window) |window| {
                ctx.pending_focus = .{ .window = window };
                std.debug.print("WM: pointer entered xdg window, pending focus\n", .{});
            }
        },
        .window_interaction => |ev| {
            // xdg 窗口被点击 → raise-on-click + 聚焦
            if (ev.window) |window| {
                ctx.pending_focus = .{ .window = window };
                // raise: 将该窗口的 node 置顶
                for (ctx.windows.items) |win| {
                    if (win.river_window == window) {
                        if (win.node) |n| n.placeTop();
                        break;
                    }
                }
                std.debug.print("WM: xdg window interaction, raise + focus\n", .{});
            }
        },
        .shell_surface_interaction => |ev| {
            // KDP shell surface 被点击 → raise-on-click + 聚焦
            if (ev.shell_surface) |ss| {
                ctx.pending_focus = .{ .shell_surface = ss };
                // raise: 将该 KDP 窗口的 node 置顶
                for (ctx.kdp_windows.items) |kdp_win| {
                    if (kdp_win.shell_surface == ss) {
                        if (kdp_win.node) |n| n.placeTop();
                        break;
                    }
                }
                std.debug.print("WM: KDP shell surface interaction, raise + focus\n", .{});
            }
        },
        .pointer_leave => {},
        else => {},
    }
}

fn wmListener(wm: *river.WindowManagerV1, event: river.WindowManagerV1.Event, ctx: *Context) void {
    std.debug.print("WM: event received: {}\n", .{@intFromEnum(event)});
    switch (event) {
        .window => |ev| {
            const win = ctx.allocator.create(Window) catch return;
            win.* = .{
                .river_window = ev.id,
                .node = ev.id.getNode() catch null,
            };
            ev.id.setListener(*Window, windowListener, win);
            ctx.windows.append(ctx.allocator, win) catch {
                ctx.allocator.destroy(win);
                return;
            };
            // 自动聚焦第一个窗口
            if (ctx.focused == null) {
                ctx.pending_focus = .{ .window = ev.id };
            }
            std.debug.print("WM: new xdg window (total: {})\n", .{ctx.windows.items.len});
        },
        .output => |ev| {
            const out = ctx.allocator.create(Output) catch return;
            out.* = .{
                .river_output = ev.id,
                .width = 0,
                .height = 0,
            };
            ev.id.setListener(*Output, outputListener, out);
            ctx.outputs.append(ctx.allocator, out) catch {
                ctx.allocator.destroy(out);
                return;
            };
            std.debug.print("WM: new output\n", .{});
        },
        .manage_start => {
            ctx.in_manage_sequence = true;

            // 应用待聚焦目标
            if (ctx.pending_focus) |focus| {
                if (ctx.seats.items.len > 0) {
                    const seat = ctx.seats.items[0].river_seat;
                    switch (focus) {
                        .window => |w| seat.focusWindow(w),
                        .shell_surface => |ss| seat.focusShellSurface(ss),
                    }
                    ctx.focused = focus;
                    std.debug.print("WM: applied focus\n", .{});
                }
                ctx.pending_focus = null;
            }

            // 3.1: 对 xdg 窗口请求 SSD 装饰
            for (ctx.windows.items) |win| {
                if (!win.ssd_requested) {
                    // 仅对支持 SSD 的窗口请求（decoration_hint != 0 即 only_supports_csd）
                    if (win.decoration_hint != 0) {
                        win.river_window.useSsd();
                        std.debug.print("WM: requested SSD for xdg window\n", .{});
                    }
                    win.ssd_requested = true;
                }
            }

            proposeDimensions(ctx);
            // 通知内核窗口列表变更
            notifyWindowList(ctx);
            wm.manageFinish();
            ctx.in_manage_sequence = false;
        },
        .render_start => {
            ctx.in_render_sequence = true;

            // 3.1: 设置 xdg 窗口边框颜色（render 序列中执行）
            for (ctx.windows.items) |win| {
                const is_focused = if (ctx.focused) |f| switch (f) {
                    .window => |w| w == win.river_window,
                    .shell_surface => false,
                } else false;

                // 边框颜色：焦点窗口用 Kairo Blue，非焦点用 Surface 色
                // set_borders 参数：edges, width, r, g, b, a（32-bit RGBA）
                const all_edges = river.WindowV1.Edges{ .top = true, .bottom = true, .left = true, .right = true };
                if (is_focused) {
                    // Kairo Blue #4A7CFF → RGBA32
                    win.river_window.setBorders(all_edges, 2, 0x4A4A4A4A, 0x7C7C7C7C, 0xFFFFFFFF, 0xFFFFFFFF);
                } else {
                    // Surface #16161E → RGBA32
                    win.river_window.setBorders(all_edges, 2, 0x16161616, 0x16161616, 0x1E1E1E1E, 0xF2F2F2F2);
                }
            }

            positionWindows(ctx);
            wm.renderFinish();
            ctx.in_render_sequence = false;
        },
        .seat => |ev| {
            const seat_obj = ctx.allocator.create(Seat) catch return;
            seat_obj.* = .{ .river_seat = ev.id };
            ev.id.setListener(*Context, seatListener, ctx);
            ctx.seats.append(ctx.allocator, seat_obj) catch {
                ctx.allocator.destroy(seat_obj);
                return;
            };
            std.debug.print("WM: new seat\n", .{});
        },
        else => {},
    }
}

// ============================================================
// 布局算法
// ============================================================

/// 面板高度（底部任务栏预留空间）
const PANEL_HEIGHT: i32 = 36;

/// 计算可见窗口（排除最小化的）总数
fn totalWindowCount(ctx: *Context) usize {
    var count: usize = 0;
    for (ctx.windows.items) |win| {
        if (!win.minimized) count += 1;
    }
    for (ctx.kdp_windows.items) |kdp_win| {
        if (!kdp_win.minimized) count += 1;
    }
    return count;
}

/// Manage sequence: 为 xdg 窗口提议尺寸
fn proposeDimensions(ctx: *Context) void {
    if (ctx.outputs.items.len == 0) return;
    const output = ctx.outputs.items[0];

    const width = output.width;
    const height = output.height;

    const total = totalWindowCount(ctx);
    if (total == 0) return;

    const pad: i32 = 10;

    var available_width = width;
    if (ctx.agent_active) {
        available_width = @divFloor(width * 70, 100);
    }

    const effective_width = available_width - (2 * pad);
    const effective_height = height - PANEL_HEIGHT - (2 * pad);

    // xdg 窗口参与 proposeDimensions
    var visible_xdg: usize = 0;
    for (ctx.windows.items) |win| {
        if (!win.minimized) visible_xdg += 1;
    }
    if (visible_xdg == 0) return; // KDP 窗口不需要 proposeDimensions

    // 5.1: 最大化窗口占满可用区域
    for (ctx.windows.items) |win| {
        if (win.minimized) {
            win.river_window.hide();
            continue;
        }
        if (win.maximized) {
            win.river_window.proposeDimensions(effective_width, effective_height);
            win.river_window.informMaximized();
            continue;
        }
    }

    // 非最大化窗口走正常布局
    if (total == 1 and visible_xdg == 1) {
        for (ctx.windows.items) |win| {
            if (!win.minimized and !win.maximized) {
                win.river_window.proposeDimensions(effective_width, effective_height);
            }
        }
    } else {
        const master_width = @divFloor(effective_width, 2) - @divFloor(pad, 2);
        const stack_width = effective_width - master_width - pad;
        const stack_count: i32 = @intCast(@max(1, total - 1));
        const stack_height = @divFloor(effective_height, stack_count) - pad;

        var idx: usize = 0;
        for (ctx.windows.items) |win| {
            if (win.minimized or win.maximized) continue;
            if (idx == 0) {
                win.river_window.proposeDimensions(master_width, effective_height);
            } else {
                win.river_window.proposeDimensions(stack_width, stack_height);
            }
            idx += 1;
        }
    }

    std.debug.print("WM: proposed dimensions for {} xdg windows (total: {})\n", .{ visible_xdg, total });
}

/// Render sequence: 定位所有窗口节点（xdg + KDP）
fn positionWindows(ctx: *Context) void {
    if (ctx.outputs.items.len == 0) return;
    const output = ctx.outputs.items[0];

    const width = output.width;
    const total = totalWindowCount(ctx);
    if (total == 0) return;

    const pad: i32 = 10;

    var available_width = width;
    if (ctx.agent_active) {
        available_width = @divFloor(width * 70, 100);
    }

    const effective_width = available_width - (2 * pad);
    const effective_height = output.height - PANEL_HEIGHT - (2 * pad);

    // 5.1: 最大化窗口占满可用区域
    for (ctx.windows.items) |win| {
        if (win.maximized and !win.minimized) {
            if (win.node) |n| n.setPosition(pad, pad);
        }
    }

    // 收集可见且非最大化的窗口统一定位
    if (total == 1) {
        // 单窗口全屏
        for (ctx.windows.items) |win| {
            if (!win.minimized and !win.maximized) {
                if (win.node) |n| n.setPosition(pad, pad);
            }
        }
        for (ctx.kdp_windows.items) |kdp_win| {
            if (!kdp_win.minimized) {
                if (kdp_win.node) |n| n.setPosition(pad, pad);
            }
        }
    } else {
        const master_width = @divFloor(effective_width, 2) - @divFloor(pad, 2);
        const stack_count: i32 = @intCast(@max(1, total - 1));
        const stack_height = @divFloor(effective_height, stack_count) - pad;

        // 统一定位：第一个可见窗口为 master，其余为 stack
        var idx: usize = 0;

        for (ctx.windows.items) |win| {
            if (win.minimized or win.maximized) continue;
            if (idx == 0) {
                if (win.node) |n| n.setPosition(pad, pad);
            } else {
                const y_offset = pad + @as(i32, @intCast(idx - 1)) * (stack_height + pad);
                if (win.node) |n| n.setPosition(pad + master_width + pad, y_offset);
            }
            idx += 1;
        }

        for (ctx.kdp_windows.items) |kdp_win| {
            if (kdp_win.minimized) continue;
            if (idx == 0) {
                if (kdp_win.node) |n| n.setPosition(pad, pad);
            } else {
                const y_offset = pad + @as(i32, @intCast(idx - 1)) * (stack_height + pad);
                if (kdp_win.node) |n| n.setPosition(pad + master_width + pad, y_offset);
            }
            idx += 1;
        }
    }

    std.debug.print("WM: positioned {} windows\n", .{total});
}

/// 通过 IPC 通知内核当前窗口列表（供面板更新）
fn notifyWindowList(ctx: *Context) void {
    const client = ctx.ipc_client orelse return;

    // 收集所有窗口标题
    var titles: [16][]const u8 = undefined;
    var count: usize = 0;
    var focused_idx: ?usize = null;

    // KDP 窗口
    for (ctx.kdp_windows.items) |kdp_win| {
        if (count >= 16) break;
        // 检查是否为当前焦点
        if (ctx.focused) |f| {
            switch (f) {
                .shell_surface => |ss| {
                    if (ss == kdp_win.shell_surface) focused_idx = count;
                },
                .window => {},
            }
        }
        titles[count] = kdp_win.title;
        count += 1;
    }

    // xdg 窗口（使用实际标题）
    for (ctx.windows.items) |win| {
        if (count >= 16) break;
        // 检查是否为当前焦点
        if (ctx.focused) |f| {
            switch (f) {
                .window => |w| {
                    if (w == win.river_window) focused_idx = count;
                },
                .shell_surface => {},
            }
        }
        titles[count] = win.title orelse "Window";
        count += 1;
    }

    client.sendWindowListEvent(ctx.allocator, titles[0..count], focused_idx) catch |err| {
        std.debug.print("WM: 发送窗口列表事件失败: {}\n", .{err});
    };
}

/// 3.3: Alt+Tab 焦点循环 — 切换到下一个窗口
fn cycleFocusNext(ctx: *Context) void {
    const total = totalWindowCount(ctx);
    if (total == 0) return;

    ctx.focus_cycle_index = (ctx.focus_cycle_index + 1) % total;
    applyFocusByIndex(ctx, ctx.focus_cycle_index);
}

/// 根据统一索引设置焦点（KDP 窗口在前，xdg 窗口在后）
fn applyFocusByIndex(ctx: *Context, index: usize) void {
    const kdp_count = ctx.kdp_windows.items.len;

    if (index < kdp_count) {
        const kdp_win = ctx.kdp_windows.items[index];
        ctx.pending_focus = .{ .shell_surface = kdp_win.shell_surface };
        // raise
        if (kdp_win.node) |n| n.placeTop();
    } else {
        const xdg_idx = index - kdp_count;
        if (xdg_idx < ctx.windows.items.len) {
            const win = ctx.windows.items[xdg_idx];
            ctx.pending_focus = .{ .window = win.river_window };
            // raise
            if (win.node) |n| n.placeTop();
        }
    }

    // 触发 manage 序列以应用焦点
    if (ctx.wm_global) |wm| wm.manageDirty();
    std.debug.print("WM: focus cycle → index {}\n", .{index});
}

/// 5.1: 最大化/还原窗口
fn toggleMaximize(ctx: *Context) void {
    if (ctx.focused == null) return;
    // 触发重新布局
    if (ctx.wm_global) |wm| wm.manageDirty();
    std.debug.print("WM: toggle maximize\n", .{});
}

/// 5.2: 开始拖拽移动当前焦点窗口
fn startDragMove(ctx: *Context) void {
    if (ctx.seats.items.len == 0) return;
    const seat = ctx.seats.items[0].river_seat;
    seat.opStartPointer();
    std.debug.print("WM: start drag move\n", .{});
}

/// 关闭当前焦点窗口
fn closeCurrentWindow(ctx: *Context) void {
    if (ctx.focused == null) return;
    switch (ctx.focused.?) {
        .window => |w| w.close(),
        .shell_surface => |ss| {
            // KDP 窗口：通过 closeKdpWindow 完整销毁
            for (ctx.kdp_windows.items) |kdp_win| {
                if (kdp_win.shell_surface == ss) {
                    closeKdpWindow(ctx, kdp_win);
                    return;
                }
            }
        },
    }
    std.debug.print("WM: close current window\n", .{});
}

/// 关闭指定 KDP 窗口（销毁 surface 并从列表移除）
fn closeKdpWindow(ctx: *Context, target: *KdpWindow) void {
    // 如果当前焦点是该窗口，清除焦点
    if (ctx.focused) |f| {
        switch (f) {
            .shell_surface => |ss| {
                if (ss == target.shell_surface) {
                    ctx.focused = null;
                }
            },
            .window => {},
        }
    }

    // 销毁 Wayland 资源
    target.kairo_surface.destroy();
    target.shell_surface.destroy();
    target.wl_surface.destroy();

    // 从列表中移除
    for (ctx.kdp_windows.items, 0..) |kdp_win, i| {
        if (kdp_win == target) {
            _ = ctx.kdp_windows.orderedRemove(i);
            ctx.allocator.destroy(target);
            break;
        }
    }

    // 切换焦点到下一个可见窗口
    if (ctx.focused == null and totalWindowCount(ctx) > 0) {
        cycleFocusNext(ctx);
    }

    // 触发重新布局
    if (ctx.wm_global) |wm| wm.manageDirty();
    std.debug.print("WM: closed KDP window (remaining: {})\n", .{ctx.kdp_windows.items.len});
}

/// 将键盘事件通过 IPC 转发给内核
fn forwardKeyEvent(ctx: *Context, window_title: []const u8, key: u32, state: u32, modifiers: u32) void {
    const client = ctx.ipc_client orelse return;

    var payload = std.ArrayList(u8){};
    defer payload.deinit(ctx.allocator);

    // 编码 MsgPack: { topic: "window.key_event", window: title, key: uint, state: uint, modifiers: uint }
    ipc.encodeMapHeader(&payload, ctx.allocator, 5) catch return;
    ipc.encodeString(&payload, ctx.allocator, "topic") catch return;
    ipc.encodeString(&payload, ctx.allocator, "window.key_event") catch return;
    ipc.encodeString(&payload, ctx.allocator, "window") catch return;
    ipc.encodeString(&payload, ctx.allocator, window_title) catch return;
    ipc.encodeString(&payload, ctx.allocator, "key") catch return;
    encodeUint32(&payload, ctx.allocator, key) catch return;
    ipc.encodeString(&payload, ctx.allocator, "state") catch return;
    encodeUint32(&payload, ctx.allocator, state) catch return;
    ipc.encodeString(&payload, ctx.allocator, "modifiers") catch return;
    encodeUint32(&payload, ctx.allocator, modifiers) catch return;

    const len: u32 = @intCast(payload.items.len);
    var header: [8]u8 = undefined;
    std.mem.writeInt(u16, header[0..2], ipc.MAGIC, .big);
    header[2] = ipc.VERSION;
    header[3] = @intFromEnum(ipc.PacketType.EVENT);
    std.mem.writeInt(u32, header[4..8], len, .big);
    client.stream.writeAll(&header) catch return;
    client.stream.writeAll(payload.items) catch return;
}

/// MsgPack uint32 编码
fn encodeUint32(list: *std.ArrayList(u8), allocator: std.mem.Allocator, val: u32) !void {
    if (val < 128) {
        // positive fixint
        try list.append(allocator, @intCast(val));
    } else if (val < 256) {
        // uint 8
        try list.append(allocator, 0xCC);
        try list.append(allocator, @intCast(val));
    } else if (val < 65536) {
        // uint 16
        try list.append(allocator, 0xCD);
        var buf: [2]u8 = undefined;
        std.mem.writeInt(u16, &buf, @intCast(val), .big);
        try list.appendSlice(allocator, &buf);
    } else {
        // uint 32
        try list.append(allocator, 0xCE);
        var buf: [4]u8 = undefined;
        std.mem.writeInt(u32, &buf, val, .big);
        try list.appendSlice(allocator, &buf);
    }
}

/// 处理来自内核的 IPC 命令
fn handleIpcCommand(ctx: *Context, packet: ipc.Client.Packet) void {
    if (packet.type != .EVENT and packet.type != .REQUEST) return;

    const payload = packet.payload;

    // 检查 "window.focus" 命令（面板点击切换焦点）
    if (std.mem.indexOf(u8, payload, "window.focus") != null) {
        // 简化解析：查找窗口标题并匹配
        std.debug.print("WM: received window.focus IPC\n", .{});
        // 通过 IPC 传入的窗口索引切换焦点
        // 查找 "index" 字段
        if (std.mem.indexOf(u8, payload, "index")) |idx| {
            const search_start = idx + 5; // "index" 长度
            if (search_start + 1 < payload.len) {
                // MsgPack positive fixint: 0x00-0x7F
                const val = payload[search_start + 1]; // 跳过可能的类型标记
                if (val < 128) {
                    applyFocusByIndex(ctx, val);
                }
            }
        }
        return;
    }

    // 检查 "desktop.launcher.toggle" 命令
    if (std.mem.indexOf(u8, payload, "desktop.launcher.toggle") != null) {
        ctx.launcher_visible = !ctx.launcher_visible;
        std.debug.print("WM: launcher toggle → {}\n", .{ctx.launcher_visible});
        // 通知内核切换启动器
        if (ctx.ipc_client) |client| {
            var event_payload = std.ArrayList(u8){};
            defer event_payload.deinit(ctx.allocator);
            ipc.encodeMapHeader(&event_payload, ctx.allocator, 2) catch return;
            ipc.encodeString(&event_payload, ctx.allocator, "topic") catch return;
            ipc.encodeString(&event_payload, ctx.allocator, "desktop.launcher.toggle") catch return;
            ipc.encodeString(&event_payload, ctx.allocator, "visible") catch return;
            event_payload.append(ctx.allocator, if (ctx.launcher_visible) 0xC3 else 0xC2) catch return;

            const len: u32 = @intCast(event_payload.items.len);
            var header: [8]u8 = undefined;
            std.mem.writeInt(u16, header[0..2], ipc.MAGIC, .big);
            header[2] = ipc.VERSION;
            header[3] = @intFromEnum(ipc.PacketType.EVENT);
            std.mem.writeInt(u32, header[4..8], len, .big);
            client.stream.writeAll(&header) catch return;
            client.stream.writeAll(event_payload.items) catch return;
        }
        return;
    }

    // 检查 "window.cycle" 命令（Alt+Tab）
    if (std.mem.indexOf(u8, payload, "window.cycle") != null) {
        cycleFocusNext(ctx);
        return;
    }

    // 检查 "window.close" 命令（Alt+F4）
    if (std.mem.indexOf(u8, payload, "window.close") != null) {
        closeCurrentWindow(ctx);
        return;
    }

    // 5.1: 检查 "window.maximize" 命令
    if (std.mem.indexOf(u8, payload, "window.maximize") != null) {
        if (ctx.focused) |f| {
            switch (f) {
                .window => |w| {
                    for (ctx.windows.items) |win| {
                        if (win.river_window == w) {
                            win.maximized = !win.maximized;
                            break;
                        }
                    }
                },
                .shell_surface => |ss| {
                    for (ctx.kdp_windows.items) |kdp_win| {
                        if (kdp_win.shell_surface == ss) {
                            kdp_win.maximized = !kdp_win.maximized;
                            break;
                        }
                    }
                },
            }
            if (ctx.wm_global) |wm| wm.manageDirty();
        }
        return;
    }

    // 5.1: 检查 "window.minimize" 命令
    if (std.mem.indexOf(u8, payload, "window.minimize") != null) {
        if (ctx.focused) |f| {
            switch (f) {
                .window => |w| {
                    for (ctx.windows.items) |win| {
                        if (win.river_window == w) {
                            win.minimized = true;
                            break;
                        }
                    }
                },
                .shell_surface => |ss| {
                    for (ctx.kdp_windows.items) |kdp_win| {
                        if (kdp_win.shell_surface == ss) {
                            kdp_win.minimized = true;
                            break;
                        }
                    }
                },
            }
            // 切换焦点到下一个可见窗口
            cycleFocusNext(ctx);
            if (ctx.wm_global) |wm| wm.manageDirty();
        }
        return;
    }

    // 5.2: 检查 "window.drag" 命令（开始拖拽移动）
    if (std.mem.indexOf(u8, payload, "window.drag") != null) {
        startDragMove(ctx);
        return;
    }

    // 桌面图标点击：创建对应应用窗口
    if (std.mem.indexOf(u8, payload, "desktop.launch_app:") != null) {
        // 从 payload 中精确提取 appId（冒号后的部分）
        const marker = "desktop.launch_app:";
        const marker_idx = std.mem.indexOf(u8, payload, marker) orelse return;
        const app_id_start = marker_idx + marker.len;
        if (app_id_start >= payload.len) return;
        // appId 到 payload 末尾（纯文本）或下一个非字母字符（MsgPack）
        var app_id_end = app_id_start;
        while (app_id_end < payload.len and payload[app_id_end] >= 0x20 and payload[app_id_end] < 0x7F) {
            app_id_end += 1;
        }
        const app_id = payload[app_id_start..app_id_end];
        std.debug.print("WM: launch_app exact id='{s}'\n", .{app_id});

        if (std.mem.eql(u8, app_id, "chrome")) {
            const chrome_json =
                \\{"type":"root","children":[
                \\  {"type":"rect","id":"bg","x":0,"y":0,"width":900,"height":600,
                \\   "color":[0.051,0.051,0.071,1.0]},
                \\  {"type":"rect","id":"titlebar","x":0,"y":0,"width":900,"height":36,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"title_text","x":12,"y":10,"text":"Chrome - Google",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                \\  {"type":"rect","id":"btn_close","x":872,"y":10,"width":16,"height":16,
                \\   "color":[0.557,0.557,0.604,0.8],"action":"close"},
                \\  {"type":"rect","id":"toolbar-bg","x":0,"y":36,"width":900,"height":36,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"btn-back","x":12,"y":46,"text":"<",
                \\   "color":[0.557,0.557,0.604,0.8],"scale":2},
                \\  {"type":"text","id":"btn-forward","x":32,"y":46,"text":">",
                \\   "color":[0.353,0.353,0.431,0.6],"scale":2},
                \\  {"type":"input","id":"address-bar","x":76,"y":42,"width":812,"height":24,
                \\   "value":"https://www.google.com","placeholder":"Enter URL..."},
                \\  {"type":"rect","id":"content-bg","x":0,"y":72,"width":900,"height":528,
                \\   "color":[0.051,0.051,0.071,1.0]},
                \\  {"type":"text","id":"google-logo","x":370,"y":200,"text":"Google",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":4},
                \\  {"type":"rect","id":"search-box","x":210,"y":260,"width":480,"height":36,
                \\   "color":[0.118,0.118,0.165,0.92],"radius":16,"border_width":1,
                \\   "border_color":[0.165,0.165,0.235,0.5]},
                \\  {"type":"input","id":"search-input","x":230,"y":266,"width":440,"height":24,
                \\   "placeholder":"Google Search"}
                \\]}
            ;
            createKdpWindow(ctx, "Chrome", chrome_json);
        } else if (std.mem.eql(u8, app_id, "agent")) {
            const agent_json =
                \\{"type":"root","children":[
                \\  {"type":"rect","id":"bg","x":0,"y":0,"width":600,"height":500,
                \\   "color":[0.051,0.051,0.071,1.0]},
                \\  {"type":"rect","id":"titlebar","x":0,"y":0,"width":600,"height":36,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"title_text","x":12,"y":10,"text":"Kairo Agent",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                \\  {"type":"rect","id":"btn_close","x":572,"y":10,"width":16,"height":16,
                \\   "color":[0.557,0.557,0.604,0.8],"action":"close"},
                \\  {"type":"rect","id":"msg-area","x":0,"y":36,"width":600,"height":388,
                \\   "color":[0.051,0.051,0.071,1.0]},
                \\  {"type":"rect","id":"msg-bubble-0","x":16,"y":48,"width":300,"height":32,
                \\   "color":[0.118,0.118,0.165,0.92],"radius":8},
                \\  {"type":"text","id":"msg-text-0","x":28,"y":56,"text":"Hello! I'm Kairo Agent.",
                \\   "color":[0.239,0.839,0.784,1.0],"scale":2},
                \\  {"type":"rect","id":"msg-bubble-1","x":16,"y":88,"width":320,"height":32,
                \\   "color":[0.118,0.118,0.165,0.92],"radius":8},
                \\  {"type":"text","id":"msg-text-1","x":28,"y":96,"text":"How can I help you today?",
                \\   "color":[0.239,0.839,0.784,1.0],"scale":2},
                \\  {"type":"rect","id":"input-divider","x":0,"y":424,"width":600,"height":1,
                \\   "color":[0.165,0.165,0.235,0.5]},
                \\  {"type":"rect","id":"input-area","x":0,"y":425,"width":600,"height":47,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"rect","id":"agent-dot","x":12,"y":442,"width":8,"height":8,
                \\   "color":[0.204,0.78,0.349,1.0],"radius":4},
                \\  {"type":"input","id":"chat-input","x":28,"y":433,"width":500,"height":28,
                \\   "placeholder":"Type a message..."},
                \\  {"type":"rect","id":"btn-send","x":536,"y":433,"width":52,"height":28,
                \\   "color":[0.29,0.486,1.0,1.0],"radius":4,"action":"send"},
                \\  {"type":"text","id":"btn-send-text","x":548,"y":439,"text":"Send",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":1},
                \\  {"type":"rect","id":"statusbar","x":0,"y":472,"width":600,"height":28,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"status_left","x":12,"y":478,"text":"Agent Ready",
                \\   "color":[0.557,0.557,0.604,0.8],"scale":1},
                \\  {"type":"text","id":"status_right","x":504,"y":478,"text":"Kairo v0.1.0",
                \\   "color":[0.557,0.557,0.604,0.8],"scale":1}
                \\]}
            ;
            createKdpWindow(ctx, "Agent", agent_json);
        } else if (std.mem.eql(u8, app_id, "terminal")) {
            const term_json =
                \\{"type":"root","children":[
                \\  {"type":"rect","id":"bg","x":0,"y":0,"width":800,"height":500,
                \\   "color":[0.051,0.051,0.071,1.0]},
                \\  {"type":"rect","id":"titlebar","x":0,"y":0,"width":800,"height":36,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"title_text","x":12,"y":10,"text":"Terminal",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                \\  {"type":"rect","id":"btn_close","x":772,"y":10,"width":16,"height":16,
                \\   "color":[0.557,0.557,0.604,0.8],"action":"close"},
                \\  {"type":"rect","id":"content","x":0,"y":36,"width":800,"height":436,
                \\   "color":[0.051,0.051,0.071,1.0]},
                \\  {"type":"text","id":"prompt","x":12,"y":48,"text":"kairo@localhost:~$",
                \\   "color":[0.204,0.78,0.349,1.0],"scale":2},
                \\  {"type":"rect","id":"cursor","x":300,"y":48,"width":16,"height":16,
                \\   "color":[0.91,0.91,0.93,0.8]},
                \\  {"type":"rect","id":"statusbar","x":0,"y":472,"width":800,"height":28,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"status_left","x":12,"y":478,"text":"bash",
                \\   "color":[0.557,0.557,0.604,0.8],"scale":1},
                \\  {"type":"text","id":"status_right","x":740,"y":478,"text":"UTF-8",
                \\   "color":[0.557,0.557,0.604,0.8],"scale":1}
                \\]}
            ;
            createKdpWindow(ctx, "Terminal", term_json);
        } else if (std.mem.eql(u8, app_id, "files")) {
            const files_json =
                \\{"type":"root","children":[
                \\  {"type":"rect","id":"bg","x":0,"y":0,"width":900,"height":600,
                \\   "color":[0.051,0.051,0.071,1.0]},
                \\  {"type":"rect","id":"titlebar","x":0,"y":0,"width":900,"height":36,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"title_text","x":12,"y":10,"text":"Files - /home",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                \\  {"type":"rect","id":"btn_close","x":872,"y":10,"width":16,"height":16,
                \\   "color":[0.557,0.557,0.604,0.8],"action":"close"},
                \\  {"type":"rect","id":"sidebar","x":0,"y":36,"width":220,"height":536,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"fav-title","x":12,"y":48,"text":"Favorites",
                \\   "color":[0.557,0.557,0.604,0.8],"scale":1},
                \\  {"type":"text","id":"fav-home","x":12,"y":64,"text":"Home",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                \\  {"type":"text","id":"fav-docs","x":12,"y":88,"text":"Documents",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                \\  {"type":"text","id":"fav-dl","x":12,"y":112,"text":"Downloads",
                \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                \\  {"type":"rect","id":"content","x":220,"y":36,"width":680,"height":536,
                \\   "color":[0.051,0.051,0.071,1.0]},
                \\  {"type":"text","id":"path","x":232,"y":48,"text":"/home",
                \\   "color":[0.557,0.557,0.604,0.8],"scale":2},
                \\  {"type":"rect","id":"statusbar","x":0,"y":572,"width":900,"height":28,
                \\   "color":[0.086,0.086,0.118,0.95]},
                \\  {"type":"text","id":"status_left","x":12,"y":578,"text":"0 items selected",
                \\   "color":[0.557,0.557,0.604,0.8],"scale":1}
                \\]}
            ;
            createKdpWindow(ctx, "Files", files_json);
        }
        return;
    }
}

// ============================================================
// Registry 与 main
// ============================================================

fn registryListener(registry: *wl.Registry, event: wl.Registry.Event, ctx: *Context) void {
    switch (event) {
        .global => |global| {
            const iface = std.mem.span(global.interface);
            if (std.mem.eql(u8, iface, std.mem.span(river.WindowManagerV1.interface.name))) {
                const wm = registry.bind(global.name, river.WindowManagerV1, 1) catch return;
                ctx.wm_global = wm;
                wm.setListener(*Context, wmListener, ctx);
                std.debug.print("Bound river_window_manager_v1\n", .{});
            } else if (std.mem.eql(u8, iface, std.mem.span(wl.Compositor.interface.name))) {
                const comp = registry.bind(global.name, wl.Compositor, 1) catch return;
                ctx.compositor_global = comp;
            } else if (std.mem.eql(u8, iface, std.mem.span(wl.Shm.interface.name))) {
                const shm = registry.bind(global.name, wl.Shm, 1) catch return;
                ctx.shm_global = shm;
            } else if (std.mem.eql(u8, iface, std.mem.span(kairo.DisplayV1.interface.name))) {
                const kd = registry.bind(global.name, kairo.DisplayV1, 2) catch return;
                ctx.kairo_display = kd;
                std.debug.print("Bound kairo_display_v1 v2\n", .{});
            }
        },
        .global_remove => {},
    }
}

/// 创建 KDP 窗口，支持指定渲染层
fn createKdpWindowWithLayer(ctx: *Context, title: []const u8, json: [:0]const u8, layer: kairo.SurfaceV1.Layer) void {
    const wm = ctx.wm_global orelse return;
    const compositor = ctx.compositor_global orelse return;
    const kd = ctx.kairo_display orelse return;

    // 1. 创建 wl_surface
    const surface = compositor.createSurface() catch |err| {
        std.debug.print("WM: 创建 wl_surface 失败: {}\n", .{err});
        return;
    };

    // 2. 创建 river_shell_surface（WM 特权接口）
    const shell_surface = wm.getShellSurface(surface) catch |err| {
        std.debug.print("WM: 创建 river_shell_surface 失败: {}\n", .{err});
        return;
    };

    // 3. 获取 river_node 用于定位
    const node = shell_surface.getNode() catch |err| {
        std.debug.print("WM: 获取 river_node 失败: {}\n", .{err});
        return;
    };

    // 4. 创建 kairo_surface 用于 KDP 渲染
    const k_surface = kd.getKairoSurface(surface) catch |err| {
        std.debug.print("WM: 创建 kairo_surface 失败: {}\n", .{err});
        return;
    };

    // 5. 设置渲染层
    k_surface.setLayer(layer);

    // 6. 设置标题
    k_surface.setTitle(@ptrCast(title.ptr));

    // 7. 提交 UI 树
    k_surface.commitUiTree(json);

    // 8. 注册到 KDP 窗口列表
    const kdp_win = ctx.allocator.create(KdpWindow) catch return;
    kdp_win.* = .{
        .wl_surface = surface,
        .shell_surface = shell_surface,
        .kairo_surface = k_surface,
        .node = node,
        .title = title,
        .ctx = ctx,
    };

    // 9. 设置 KDP surface 事件监听器（处理 user_action 等）
    k_surface.setListener(*KdpWindow, kairoSurfaceListener, kdp_win);

    ctx.kdp_windows.append(ctx.allocator, kdp_win) catch {
        ctx.allocator.destroy(kdp_win);
        return;
    };

    // wm 层窗口自动聚焦
    if (layer == .wm and ctx.focused == null) {
        ctx.pending_focus = .{ .shell_surface = shell_surface };
    }

    std.debug.print("WM: 创建 KDP 窗口 '{s}' layer={} (total KDP: {})\n", .{ title, @intFromEnum(layer), ctx.kdp_windows.items.len });
}

/// 创建 KDP 窗口（默认 wm 层）
fn createKdpWindow(ctx: *Context, title: []const u8, json: [:0]const u8) void {
    createKdpWindowWithLayer(ctx, title, json, .wm);
}

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    var ctx = Context{
        .wm_global = null,
        .compositor_global = null,
        .shm_global = null,
        .kairo_display = null,

        .windows = .empty,
        .kdp_windows = .empty,
        .outputs = .empty,
        .seats = .empty,
        .allocator = allocator,
    };
    defer ctx.windows.deinit(allocator);
    defer ctx.kdp_windows.deinit(allocator);
    defer ctx.outputs.deinit(allocator);
    defer ctx.seats.deinit(allocator);

    const display = try wl.Display.connect(null);
    const registry = try display.getRegistry();

    registry.setListener(*Context, registryListener, &ctx);

    std.debug.print("Connecting to Wayland display...\n", .{});

    // IPC 连接（KCP 协议）
    const ipc_socket_path = "/tmp/kairo-kernel.sock";
    var ipc_client_opt: ?ipc.Client = null;

    if (ipc.Client.connect(allocator, ipc_socket_path)) |conn| {
        var client = conn;
        ipc_client_opt = client;
        ctx.ipc_client = &ipc_client_opt.?;
        std.debug.print("Connected to Kernel IPC at {s}\n", .{ipc_socket_path});

        if (client.sendRequest("init-1", "system.get_metrics")) |_| {
            std.debug.print("Sent system.get_metrics request\n", .{});
        } else |err| {
            std.debug.print("Failed to send IPC request: {}\n", .{err});
        }
    } else |err| {
        std.debug.print("Failed to connect to Kernel IPC: {}\n", .{err});
    }

    defer if (ipc_client_opt) |*c| c.close();

    // 初始 roundtrip 获取 globals
    if (display.roundtrip() != .SUCCESS) return error.RoundtripFailed;

    if (ctx.wm_global == null) {
        std.debug.print("river_window_manager_v1 not found!\n", .{});
        return;
    }

    // 第二次 roundtrip：绑定 WM global 后，服务器发送初始状态
    std.debug.print("Doing second roundtrip for WM events...\n", .{});
    if (display.roundtrip() != .SUCCESS) return error.RoundtripFailed;
    if (display.flush() != .SUCCESS) return error.RoundtripFailed;
    std.debug.print("After second roundtrip: windows={}, outputs={}\n", .{ ctx.windows.items.len, ctx.outputs.items.len });

    // 创建壁纸 + 桌面图标（background 层）
    if (ctx.kairo_display != null and ctx.compositor_global != null and ctx.wm_global != null) {
        const wallpaper_json =
            \\{"type":"root","children":[
            \\  {"type":"rect","id":"wallpaper-base","x":0,"y":0,"width":1280,"height":720,
            \\   "color":[0.051,0.051,0.071,1.0]},
            \\  {"type":"rect","id":"wallpaper-glow","x":440,"y":260,"width":400,"height":200,
            \\   "color":[0.29,0.486,1.0,0.03],"radius":200},
            \\  {"type":"rect","id":"desktop-icon-terminal","x":24,"y":24,"width":64,"height":64,
            \\   "color":[0.118,0.118,0.165,0.92],"radius":8,"action":"launch:terminal"},
            \\  {"type":"text","id":"desktop-icon-symbol-terminal","x":40,"y":40,"text":">_",
            \\   "color":[0.29,0.486,1.0,1.0],"scale":4},
            \\  {"type":"text","id":"desktop-icon-label-terminal","x":28,"y":92,"text":"Terminal",
            \\   "color":[0.91,0.91,0.93,1.0],"scale":1},
            \\  {"type":"rect","id":"desktop-icon-files","x":24,"y":124,"width":64,"height":64,
            \\   "color":[0.118,0.118,0.165,0.92],"radius":8,"action":"launch:files"},
            \\  {"type":"text","id":"desktop-icon-symbol-files","x":40,"y":140,"text":"[]",
            \\   "color":[0.29,0.486,1.0,1.0],"scale":4},
            \\  {"type":"text","id":"desktop-icon-label-files","x":28,"y":192,"text":"Files",
            \\   "color":[0.91,0.91,0.93,1.0],"scale":1},
            \\  {"type":"rect","id":"desktop-icon-chrome","x":24,"y":224,"width":64,"height":64,
            \\   "color":[0.118,0.118,0.165,0.92],"radius":8,"action":"launch:chrome"},
            \\  {"type":"text","id":"desktop-icon-symbol-chrome","x":40,"y":240,"text":"@",
            \\   "color":[0.29,0.486,1.0,1.0],"scale":4},
            \\  {"type":"text","id":"desktop-icon-label-chrome","x":28,"y":292,"text":"Chrome",
            \\   "color":[0.91,0.91,0.93,1.0],"scale":1},
            \\  {"type":"rect","id":"desktop-icon-agent","x":24,"y":324,"width":64,"height":64,
            \\   "color":[0.118,0.118,0.165,0.92],"radius":8,"action":"launch:agent"},
            \\  {"type":"text","id":"desktop-icon-symbol-agent","x":40,"y":340,"text":"*",
            \\   "color":[0.29,0.486,1.0,1.0],"scale":4},
            \\  {"type":"text","id":"desktop-icon-label-agent","x":28,"y":392,"text":"Agent",
            \\   "color":[0.91,0.91,0.93,1.0],"scale":1}
            \\]}
        ;
        createKdpWindowWithLayer(&ctx, "Wallpaper", wallpaper_json, .background);

        // 创建任务栏（bottom 层）
        const panel_json =
            \\{"type":"root","children":[
            \\  {"type":"rect","id":"panel-bg","x":0,"y":0,"width":1280,"height":36,
            \\   "color":[0.086,0.086,0.118,0.95]},
            \\  {"type":"rect","id":"panel-border-top","x":0,"y":0,"width":1280,"height":1,
            \\   "color":[0.165,0.165,0.235,0.5]},
            \\  {"type":"rect","id":"panel-logo-bg","x":8,"y":6,"width":24,"height":24,
            \\   "color":[0,0,0,0],"action":"launcher_toggle"},
            \\  {"type":"text","id":"panel-logo","x":12,"y":10,"text":"<>",
            \\   "color":[0.29,0.486,1.0,1.0],"scale":2},
            \\  {"type":"rect","id":"panel-agent-dot","x":1200,"y":14,"width":8,"height":8,
            \\   "color":[0.204,0.78,0.349,1.0],"radius":4},
            \\  {"type":"text","id":"panel-clock","x":1216,"y":14,"text":"00:00",
            \\   "color":[0.557,0.557,0.604,0.8],"scale":1}
            \\]}
        ;
        createKdpWindowWithLayer(&ctx, "Panel", panel_json, .bottom);
    } else {
        std.debug.print("Skipping KDP (globals not found)\n", .{});
    }

    const wl_fd = display.getFd();
    var fds: [2]std.posix.pollfd = undefined;

    // 事件循环
    while (true) {
        fds[0] = .{
            .fd = wl_fd,
            .events = std.posix.POLL.IN,
            .revents = 0,
        };

        if (ipc_client_opt) |*client| {
            fds[1] = .{
                .fd = client.stream.handle,
                .events = std.posix.POLL.IN,
                .revents = 0,
            };
        } else {
            fds[1] = .{ .fd = -1, .events = 0, .revents = 0 };
        }

        _ = std.posix.poll(&fds, -1) catch |err| {
            std.debug.print("Poll error: {}\n", .{err});
            break;
        };

        // Wayland 事件
        if (fds[0].revents & std.posix.POLL.IN != 0) {
            if (display.dispatch() != .SUCCESS) break;
        }

        // IPC 事件
        if (fds[1].revents & std.posix.POLL.IN != 0) {
            if (ipc_client_opt) |*client| {
                if (client.readPacket(allocator)) |packet_opt| {
                    if (packet_opt) |packet| {
                        defer allocator.free(packet.payload);
                        std.debug.print("Received IPC packet: type={}, len={}\n", .{ packet.type, packet.payload.len });

                        if (ipc.Client.isAgentActiveEvent(packet)) |active| {
                            std.debug.print("Agent Active State Changed: {}\n", .{active});
                            ctx.agent_active = active;
                            if (ctx.wm_global) |wm| wm.manageDirty();
                        }

                        // 处理 IPC 命令
                        handleIpcCommand(&ctx, packet);
                    } else {
                        std.debug.print("IPC Connection closed by peer\n", .{});
                        client.close();
                        ipc_client_opt = null;
                    }
                } else |err| {
                    std.debug.print("IPC Read error: {}\n", .{err});
                    client.close();
                    ipc_client_opt = null;
                }
            }
        }

        if (display.flush() != .SUCCESS) break;
    }
}
