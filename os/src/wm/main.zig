const std = @import("std");
const wayland = @import("wayland");
const wl = wayland.client.wl;
const river = wayland.client.river;
const kairo = wayland.client.kairo;
const ipc = @import("ipc.zig");

const Window = struct {
    river_window: *river.WindowV1,
    node: ?*river.NodeV1,

    // Window state
    width: u32 = 0,
    height: u32 = 0,
};

const Output = struct {
    river_output: *river.OutputV1,
    width: i32,
    height: i32,
};

const Seat = struct {
    river_seat: *river.SeatV1,
};

const Context = struct {
    wm_global: ?*river.WindowManagerV1,
    compositor_global: ?*wl.Compositor,
    shm_global: ?*wl.Shm,
    kairo_display: ?*kairo.DisplayV1,

    windows: std.ArrayList(*Window),
    outputs: std.ArrayList(*Output),
    seats: std.ArrayList(*Seat),
    allocator: std.mem.Allocator,
    agent_active: bool = false,
    /// 待聚焦的窗口（在下一次 manage_start 时应用）
    pending_focus: ?*river.WindowV1 = null,
    /// 当前已聚焦的窗口
    focused_window: ?*river.WindowV1 = null,
};

fn windowListener(window: *river.WindowV1, event: river.WindowV1.Event, ctx: *Window) void {
    _ = window;
    switch (event) {
        .dimensions => |ev| {
            ctx.width = @intCast(ev.width);
            ctx.height = @intCast(ev.height);
        },
        .closed => {
            // We need access to the global context to remove the window from the list
            // But the listener context is *Window.
            // For simplicity in this prototype, we'll just handle cleanup when we iterate or via a global map if needed.
            // Ideally, we'd pass a struct { *Context, *Window } as context, or use @fieldParentPtr if embedded.
            // Here we just mark it? Or we can't easily remove from ArrayList without linear search.
        },
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
        .removed => {
            // Cleanup handled by owner usually
        },
        else => {},
    }
}

fn seatListener(seat: *river.SeatV1, event: river.SeatV1.Event, ctx: *Context) void {
    _ = seat;
    switch (event) {
        .pointer_enter => |ev| {
            // 鼠标进入窗口区域，设置待聚焦窗口
            if (ev.window) |window| {
                ctx.pending_focus = window;
                std.debug.print("WM: pointer entered window, pending focus\n", .{});
            }
        },
        .window_interaction => |ev| {
            // 窗口被点击/交互，设置待聚焦窗口
            if (ev.window) |window| {
                ctx.pending_focus = window;
                std.debug.print("WM: window interaction, pending focus\n", .{});
            }
        },
        .pointer_leave => {
            // 鼠标离开窗口，不清除焦点（保持 click-to-focus 语义）
        },
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
                // 分配失败时释放已创建的 Window，防止内存泄漏
                ctx.allocator.destroy(win);
                return;
            };
            // 自动聚焦第一个窗口
            if (ctx.focused_window == null) {
                ctx.pending_focus = ev.id;
            }
            std.debug.print("WM: new window (total: {})\n", .{ctx.windows.items.len});
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
                // 分配失败时释放已创建的 Output，防止内存泄漏
                ctx.allocator.destroy(out);
                return;
            };
            std.debug.print("WM: new output\n", .{});
        },
        .manage_start => {
            // 应用待聚焦窗口
            if (ctx.pending_focus) |focus_win| {
                if (ctx.seats.items.len > 0) {
                    ctx.seats.items[0].river_seat.focusWindow(focus_win);
                    ctx.focused_window = focus_win;
                    std.debug.print("WM: focused window\n", .{});
                }
                ctx.pending_focus = null;
            }
            // Manage sequence: propose dimensions for all windows
            proposeDimensions(ctx);
            wm.manageFinish();
        },
        .render_start => {
            // Render sequence: set positions for all window nodes
            positionWindows(ctx);
            wm.renderFinish();
        },
        .seat => |ev| {
            // 新 seat 创建，注册监听器
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

/// Manage sequence: propose dimensions for all windows
fn proposeDimensions(ctx: *Context) void {
    if (ctx.outputs.items.len == 0) return;
    const output = ctx.outputs.items[0];

    const width = output.width;
    const height = output.height;

    const window_count = ctx.windows.items.len;
    if (window_count == 0) return;

    const pad: i32 = 10;

    var available_width = width;
    if (ctx.agent_active) {
        available_width = @divFloor(width * 70, 100);
    }

    const effective_width = available_width - (2 * pad);
    const effective_height = height - (2 * pad);

    if (window_count == 1) {
        ctx.windows.items[0].river_window.proposeDimensions(effective_width, effective_height);
    } else {
        const master_width = @divFloor(effective_width, 2) - @divFloor(pad, 2);
        const stack_width = effective_width - master_width - pad;
        const stack_count: i32 = @intCast(window_count - 1);
        const stack_height = @divFloor(effective_height, stack_count) - pad;

        ctx.windows.items[0].river_window.proposeDimensions(master_width, effective_height);

        for (ctx.windows.items[1..]) |win| {
            win.river_window.proposeDimensions(stack_width, stack_height);
        }
    }

    std.debug.print("WM: proposed dimensions for {} windows\n", .{window_count});
}

/// Render sequence: set positions for all window nodes
fn positionWindows(ctx: *Context) void {
    if (ctx.outputs.items.len == 0) return;
    const output = ctx.outputs.items[0];

    const width = output.width;

    const window_count = ctx.windows.items.len;
    if (window_count == 0) return;

    const pad: i32 = 10;

    var available_width = width;
    if (ctx.agent_active) {
        available_width = @divFloor(width * 70, 100);
    }

    const effective_width = available_width - (2 * pad);
    const effective_height = output.height - (2 * pad);

    if (window_count == 1) {
        if (ctx.windows.items[0].node) |n| n.setPosition(pad, pad);
    } else {
        const master_width = @divFloor(effective_width, 2) - @divFloor(pad, 2);
        const stack_count: i32 = @intCast(window_count - 1);
        const stack_height = @divFloor(effective_height, stack_count) - pad;

        if (ctx.windows.items[0].node) |n| n.setPosition(pad, pad);

        for (ctx.windows.items[1..], 0..) |win, i| {
            const y_offset = pad + @as(i32, @intCast(i)) * (stack_height + pad);
            if (win.node) |n| n.setPosition(pad + master_width + pad, y_offset);
        }
    }

    std.debug.print("WM: positioned {} windows\n", .{window_count});
}

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
                const kd = registry.bind(global.name, kairo.DisplayV1, 1) catch return;
                ctx.kairo_display = kd;
                std.debug.print("Bound kairo_display_v1\n", .{});
            }
        },
        .global_remove => {},
    }
}

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    var ctx = Context{
        .wm_global = null,
        .compositor_global = null,
        .shm_global = null,
        .kairo_display = null,

        .windows = .empty,
        .outputs = .empty,
        .seats = .empty,
        .allocator = allocator,
    };
    defer ctx.windows.deinit(allocator);
    defer ctx.outputs.deinit(allocator);
    defer ctx.seats.deinit(allocator);

    const display = try wl.Display.connect(null);
    const registry = try display.getRegistry();

    registry.setListener(*Context, registryListener, &ctx);

    std.debug.print("Connecting to Wayland display...\n", .{});

    // IPC Connection (KCP)
    // We try to connect to the kernel. If it fails, we just log it and continue.
    // In a real implementation, we might want to retry or block.
    const ipc_socket_path = "/tmp/kairo-kernel.sock";
    var ipc_client_opt: ?ipc.Client = null;

    if (ipc.Client.connect(allocator, ipc_socket_path)) |conn| {
        var client = conn;
        ipc_client_opt = client;
        std.debug.print("Connected to Kernel IPC at {s}\n", .{ipc_socket_path});

        // Send Hello / Handshake
        if (client.sendRequest("init-1", "system.get_metrics")) |_| {
            std.debug.print("Sent system.get_metrics request\n", .{});
        } else |err| {
            std.debug.print("Failed to send IPC request: {}\n", .{err});
        }
    } else |err| {
        std.debug.print("Failed to connect to Kernel IPC: {}\n", .{err});
    }

    defer if (ipc_client_opt) |*c| c.close();

    // Initial roundtrip to get globals
    if (display.roundtrip() != .SUCCESS) return error.RoundtripFailed;

    if (ctx.wm_global == null) {
        std.debug.print("river_window_manager_v1 not found!\n", .{});
        return;
    }

    // Second roundtrip: after binding WM global, server sends initial state
    std.debug.print("Doing second roundtrip for WM events...\n", .{});
    if (display.roundtrip() != .SUCCESS) return error.RoundtripFailed;
    // Flush immediately - River has a 3s timeout for manage_finish
    if (display.flush() != .SUCCESS) return error.RoundtripFailed;
    std.debug.print("After second roundtrip: windows={}, outputs={}\n", .{ ctx.windows.items.len, ctx.outputs.items.len });

    // KDP: 发送品牌窗口 UI 树
    if (ctx.kairo_display != null and ctx.compositor_global != null) {
        if (ctx.compositor_global.?.createSurface()) |surface| {
            if (ctx.kairo_display.?.getKairoSurface(surface)) |k_surface| {
                std.debug.print("Created kairo_surface for brand window\n", .{});

                // 品牌窗口初始 UI 树（静态版本，后续由 TypeScript 层通过 IPC 推送动态更新）
                const json =
                    \\{"type":"root","children":[
                    \\  {"type":"rect","id":"bg","x":0,"y":0,"width":480,"height":560,
                    \\   "color":[0.051,0.051,0.071,1.0]},
                    \\  {"type":"rect","id":"titlebar","x":0,"y":0,"width":480,"height":36,
                    \\   "color":[0.0,0.0,0.0,0.0]},
                    \\  {"type":"rect","id":"btn_close","x":452,"y":10,"width":16,"height":16,
                    \\   "color":[0.557,0.557,0.604,0.3],"action":"close"},
                    \\  {"type":"text","id":"logo","x":220,"y":180,"text":"<>",
                    \\   "color":[0.29,0.486,1.0,1.0],"scale":4},
                    \\  {"type":"text","id":"brand_name","x":184,"y":228,"text":"K A I R O",
                    \\   "color":[0.91,0.91,0.93,1.0],"scale":4},
                    \\  {"type":"text","id":"subtitle","x":176,"y":268,"text":"Agent-Native OS",
                    \\   "color":[0.557,0.557,0.604,0.8],"scale":2},
                    \\  {"type":"rect","id":"divider","x":180,"y":300,"width":120,"height":1,
                    \\   "color":[0.165,0.165,0.235,0.5]},
                    \\  {"type":"rect","id":"card_terminal","x":88,"y":324,"width":140,"height":72,
                    \\   "color":[0.118,0.118,0.165,0.92],"action":"launch_terminal"},
                    \\  {"type":"text","id":"card_terminal_icon","x":100,"y":340,"text":">_",
                    \\   "color":[0.29,0.486,1.0,1.0],"scale":2},
                    \\  {"type":"text","id":"card_terminal_label","x":100,"y":368,"text":"Terminal",
                    \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                    \\  {"type":"rect","id":"card_files","x":252,"y":324,"width":140,"height":72,
                    \\   "color":[0.118,0.118,0.165,0.92],"action":"launch_files"},
                    \\  {"type":"text","id":"card_files_icon","x":264,"y":340,"text":"[]",
                    \\   "color":[0.29,0.486,1.0,1.0],"scale":2},
                    \\  {"type":"text","id":"card_files_label","x":264,"y":368,"text":"Files",
                    \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                    \\  {"type":"rect","id":"status_panel","x":100,"y":420,"width":280,"height":96,
                    \\   "color":[0.118,0.118,0.165,0.92]},
                    \\  {"type":"text","id":"status_title","x":112,"y":432,"text":"System Status",
                    \\   "color":[0.557,0.557,0.604,0.8],"scale":1},
                    \\  {"type":"text","id":"status_agent","x":112,"y":452,"text":"Agent: Ready",
                    \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                    \\  {"type":"text","id":"status_memory","x":112,"y":474,"text":"Memory: -- / --",
                    \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                    \\  {"type":"text","id":"status_uptime","x":112,"y":496,"text":"Uptime: 00:00:00",
                    \\   "color":[0.91,0.91,0.93,1.0],"scale":2},
                    \\  {"type":"text","id":"version","x":196,"y":536,"text":"v0.1.0-alpha",
                    \\   "color":[0.353,0.353,0.431,0.6],"scale":1}
                    \\]}
                ;
                k_surface.commitUiTree(json);
                std.debug.print("Sent Brand Window UI Tree\n", .{});
            } else |err| {
                std.debug.print("Failed to create kairo_surface: {}\n", .{err});
            }
        } else |err| {
            std.debug.print("Failed to create wl_surface: {}\n", .{err});
        }
    } else {
        std.debug.print("Skipping KDP (kairo_display or compositor not found)\n", .{});
    }

    const wl_fd = display.getFd();
    var fds: [2]std.posix.pollfd = undefined;

    // Event loop
    while (true) {
        // Prepare pollfds
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

        // Poll
        _ = std.posix.poll(&fds, -1) catch |err| {
            std.debug.print("Poll error: {}\n", .{err});
            break;
        };

        // Handle Wayland events
        if (fds[0].revents & std.posix.POLL.IN != 0) {
            if (display.dispatch() != .SUCCESS) break;
        }

        // Handle IPC events
        if (fds[1].revents & std.posix.POLL.IN != 0) {
            if (ipc_client_opt) |*client| {
                if (client.readPacket(allocator)) |packet_opt| {
                    if (packet_opt) |packet| {
                        defer allocator.free(packet.payload);
                        std.debug.print("Received IPC packet: type={}, len={}\n", .{ packet.type, packet.payload.len });

                        if (ipc.Client.isAgentActiveEvent(packet)) |active| {
                            std.debug.print("Agent Active State Changed: {}\n", .{active});
                            ctx.agent_active = active;
                            // Request a new manage sequence to re-layout
                            if (ctx.wm_global) |wm| wm.manageDirty();
                        }
                    } else {
                        // EOF
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

        // Flush Wayland requests
        if (display.flush() != .SUCCESS) break;
    }
}
