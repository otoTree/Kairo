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

const Context = struct {
    wm_global: ?*river.WindowManagerV1,
    compositor_global: ?*wl.Compositor,
    shm_global: ?*wl.Shm,
    kairo_display: ?*kairo.DisplayV1,

    windows: std.ArrayList(*Window),
    outputs: std.ArrayList(*Output),
    allocator: std.mem.Allocator,
    agent_active: bool = false,
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

fn wmListener(wm: *river.WindowManagerV1, event: river.WindowManagerV1.Event, ctx: *Context) void {
    switch (event) {
        .window => |ev| {
            const win = ctx.allocator.create(Window) catch return;
            win.* = .{
                .river_window = ev.id,
                .node = ev.id.getNode() catch null,
            };
            ev.id.setListener(*Window, windowListener, win);
            ctx.windows.append(ctx.allocator, win) catch return;

            // Initial mapping
            ev.id.show();
        },
        .output => |ev| {
            const out = ctx.allocator.create(Output) catch return;
            out.* = .{
                .river_output = ev.id,
                .width = 0,
                .height = 0,
            };
            ev.id.setListener(*Output, outputListener, out);
            ctx.outputs.append(ctx.allocator, out) catch return;
        },
        .render_start => {
            applyLayout(ctx);
            wm.renderFinish();
        },
        else => {},
    }
}

fn applyLayout(ctx: *Context) void {
    if (ctx.outputs.items.len == 0) return;
    const output = ctx.outputs.items[0]; // Assume single output for now

    const width = output.width;
    const height = output.height;

    // Filter out closed windows (naive check if we tracked closed state)
    // For this prototype, we assume all in list are valid.

    const window_count = ctx.windows.items.len;
    if (window_count == 0) return;

    // Padding
    const pad = 10;

    var available_width = width;
    if (ctx.agent_active) {
        available_width = @divFloor(width * 70, 100);
    }

    const effective_width = available_width - (2 * pad);
    const effective_height = height - (2 * pad);

    if (window_count == 1) {
        const win = ctx.windows.items[0];
        win.river_window.proposeDimensions(effective_width, effective_height);
        if (win.node) |n| n.setPosition(pad, pad);
    } else {
        // Master/Stack
        const master_width = @divFloor(effective_width, 2) - (pad / 2);
        const stack_width = effective_width - master_width - pad;
        const stack_height = @divFloor(effective_height, @as(i32, @intCast(window_count - 1))) - pad;

        // Master (Left)
        const master = ctx.windows.items[0];
        master.river_window.proposeDimensions(master_width, effective_height);
        if (master.node) |n| n.setPosition(pad, pad);

        // Stack (Right)
        for (ctx.windows.items[1..], 0..) |win, i| {
            const y_offset = pad + @as(i32, @intCast(i)) * (stack_height + pad);
            win.river_window.proposeDimensions(stack_width, stack_height);
            if (win.node) |n| n.setPosition(pad + master_width + pad, y_offset);
        }
    }
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
        .allocator = allocator,
    };
    defer ctx.windows.deinit(allocator);
    defer ctx.outputs.deinit(allocator);

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

    // Phase 4: Test KDP
    if (ctx.kairo_display != null and ctx.compositor_global != null) {
        if (ctx.compositor_global.?.createSurface()) |surface| {
            if (ctx.kairo_display.?.getKairoSurface(surface)) |k_surface| {
                std.debug.print("Created kairo_surface\n", .{});

                const json = "{\"type\":\"root\",\"children\":[]}";
                k_surface.commitUiTree(json);
                std.debug.print("Sent UI Tree: {s}\n", .{json});
            } else |err| {
                std.debug.print("Failed to create kairo_surface: {}\n", .{err});
            }
        } else |err| {
            std.debug.print("Failed to create wl_surface: {}\n", .{err});
        }
    } else {
        std.debug.print("Skipping KDP test (kairo_display or compositor not found)\n", .{});
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
                            applyLayout(&ctx);
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
