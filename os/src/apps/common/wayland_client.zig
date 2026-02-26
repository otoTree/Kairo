// xdg-shell Wayland 客户端框架
// 封装完整的窗口生命周期：连接、创建窗口、事件循环
const std = @import("std");
const mem = std.mem;
const posix = std.posix;
const wayland = @import("wayland");
const wl = wayland.client.wl;
const xdg = wayland.client.xdg;
const ShmBuffer = @import("shm_buffer").ShmBuffer;
const DoubleBuffer = @import("shm_buffer").DoubleBuffer;

/// 绘制回调
pub const DrawFn = *const fn (app: *App) void;
/// 键盘回调：key=keycode, state=0(释放)/1(按下)
pub const KeyFn = *const fn (app: *App, key: u32, state: u32) void;
/// 鼠标点击回调
pub const ClickFn = *const fn (app: *App, x: i32, y: i32, button: u32) void;
/// 鼠标滚轮回调
pub const ScrollFn = *const fn (app: *App, axis: u32, value: i32) void;
/// 额外 fd 可读回调
pub const ExtraFdFn = *const fn (app: *App) void;

pub const App = struct {
    // Wayland 全局对象
    display: *wl.Display,
    compositor: ?*wl.Compositor = null,
    shm: ?*wl.Shm = null,
    wm_base: ?*xdg.WmBase = null,
    seat: ?*wl.Seat = null,
    // 窗口对象
    surface: ?*wl.Surface = null,
    xdg_surface: ?*xdg.Surface = null,
    xdg_toplevel: ?*xdg.Toplevel = null,
    // 输入设备
    keyboard: ?*wl.Keyboard = null,
    pointer: ?*wl.Pointer = null,
    // 双缓冲
    buffers: ?DoubleBuffer = null,
    width: u32,
    height: u32,
    // 状态
    running: bool = true,
    configured: bool = false,
    needs_redraw: bool = true,
    // 鼠标位置（由 pointer motion 更新）
    pointer_x: i32 = 0,
    pointer_y: i32 = 0,
    // 回调
    on_draw: ?DrawFn = null,
    on_key: ?KeyFn = null,
    on_click: ?ClickFn = null,
    on_scroll: ?ScrollFn = null,
    // 用户数据
    user_data: ?*anyopaque = null,
    // 内部：用于 destroy 时释放堆内存
    allocator: ?std.mem.Allocator = null,

    /// 在堆上创建 App（地址稳定，listener userdata 不会悬空）
    pub fn create(allocator: std.mem.Allocator, title: [*:0]const u8, w: u32, h: u32) !*App {
        const display = try wl.Display.connect(null);

        const app = try allocator.create(App);
        app.* = App{
            .display = display,
            .width = w,
            .height = h,
            .allocator = allocator,
        };

        // 获取 registry 并绑定全局接口
        const registry = try display.getRegistry();
        registry.setListener(*App, registryListener, app);
        if (display.roundtrip() != .SUCCESS) return error.RoundtripFailed;

        const compositor = app.compositor orelse return error.NoCompositor;
        const shm = app.shm orelse return error.NoShm;
        const wm_base = app.wm_base orelse return error.NoWmBase;

        // 设置 wm_base ping 监听器
        wm_base.setListener(*App, wmBaseListener, app);

        // 创建 surface 和 xdg 窗口
        app.surface = try compositor.createSurface();
        app.xdg_surface = try wm_base.getXdgSurface(app.surface.?);
        app.xdg_surface.?.setListener(*App, xdgSurfaceListener, app);
        app.xdg_toplevel = try app.xdg_surface.?.getToplevel();
        app.xdg_toplevel.?.setListener(*App, xdgToplevelListener, app);
        app.xdg_toplevel.?.setTitle(title);

        // 初始提交触发 configure
        app.surface.?.commit();
        if (display.roundtrip() != .SUCCESS) return error.RoundtripFailed;

        // 创建双缓冲
        app.buffers = try DoubleBuffer.create(shm, w, h);

        return app;
    }

    /// 获取当前可绘制的像素缓冲区
    pub fn getPixelBuffer(self: *App) [*]u32 {
        var bufs = &self.buffers.?;
        return bufs.getDrawable().data;
    }

    /// 提交当前帧到合成器
    pub fn commitFrame(self: *App) void {
        var bufs = &self.buffers.?;
        const buf = bufs.getDrawable();
        self.surface.?.attach(buf.wl_buffer, 0, 0);
        self.surface.?.damage(0, 0, @intCast(self.width), @intCast(self.height));
        self.surface.?.commit();
        bufs.swap();
    }

    /// 请求重绘
    pub fn requestRedraw(self: *App) void {
        self.needs_redraw = true;
    }

    /// 基础事件循环（仅 Wayland fd）
    pub fn run(self: *App) !void {
        try self.runWithExtraFd(-1, null, -1);
    }

    /// 扩展事件循环（Wayland fd + 额外 fd，支持超时）
    pub fn runWithExtraFd(self: *App, extra_fd: posix.fd_t, on_extra: ?ExtraFdFn, timeout_ms: i32) !void {
        const wl_fd = self.display.getFd();

        while (self.running) {
            // 绘制
            if (self.needs_redraw and self.configured) {
                self.needs_redraw = false;
                if (self.on_draw) |draw| draw(self);
                self.commitFrame();
            }

            _ = self.display.flush();

            var fds: [2]posix.pollfd = .{
                .{ .fd = wl_fd, .events = posix.POLL.IN, .revents = 0 },
                .{ .fd = extra_fd, .events = if (extra_fd >= 0) posix.POLL.IN else 0, .revents = 0 },
            };
            const nfds: usize = if (extra_fd >= 0) 2 else 1;

            const ret = posix.poll(fds[0..nfds], timeout_ms) catch |err| {
                std.debug.print("poll 错误: {}\n", .{err});
                break;
            };

            // 超时
            if (ret == 0) {
                self.needs_redraw = true;
                continue;
            }

            // Wayland 事件
            if (fds[0].revents & posix.POLL.IN != 0) {
                if (self.display.dispatch() != .SUCCESS) break;
            }

            // 额外 fd 事件
            if (extra_fd >= 0 and fds[1].revents & posix.POLL.IN != 0) {
                if (on_extra) |cb| cb(self);
            }
        }
    }

    pub fn destroy(self: *App) void {
        if (self.buffers) |*bufs| bufs.destroy();
        if (self.xdg_toplevel) |t| t.destroy();
        if (self.xdg_surface) |s| s.destroy();
        if (self.surface) |s| s.destroy();
        self.display.disconnect();
        if (self.allocator) |alloc| alloc.destroy(self);
    }

    // === Wayland 事件监听器 ===

    fn registryListener(registry: *wl.Registry, event: wl.Registry.Event, app: *App) void {
        switch (event) {
            .global => |global| {
                if (mem.orderZ(u8, global.interface, wl.Compositor.interface.name) == .eq) {
                    app.compositor = registry.bind(global.name, wl.Compositor, 1) catch return;
                } else if (mem.orderZ(u8, global.interface, wl.Shm.interface.name) == .eq) {
                    app.shm = registry.bind(global.name, wl.Shm, 1) catch return;
                } else if (mem.orderZ(u8, global.interface, xdg.WmBase.interface.name) == .eq) {
                    app.wm_base = registry.bind(global.name, xdg.WmBase, 2) catch return;
                } else if (mem.orderZ(u8, global.interface, wl.Seat.interface.name) == .eq) {
                    const seat = registry.bind(global.name, wl.Seat, 7) catch return;
                    app.seat = seat;
                    seat.setListener(*App, seatListener, app);
                }
            },
            .global_remove => {},
        }
    }

    fn wmBaseListener(wm_base: *xdg.WmBase, event: xdg.WmBase.Event, _: *App) void {
        switch (event) {
            .ping => |ping| {
                // 必须回复 pong，否则合成器认为客户端无响应
                wm_base.pong(ping.serial);
            },
        }
    }

    fn xdgSurfaceListener(xdg_surface: *xdg.Surface, event: xdg.Surface.Event, app: *App) void {
        switch (event) {
            .configure => |configure| {
                xdg_surface.ackConfigure(configure.serial);
                app.configured = true;
                app.needs_redraw = true;
            },
        }
    }

    fn xdgToplevelListener(_: *xdg.Toplevel, event: xdg.Toplevel.Event, app: *App) void {
        switch (event) {
            .configure => {},
            .close => app.running = false,
        }
    }

    fn seatListener(_: *wl.Seat, event: wl.Seat.Event, app: *App) void {
        switch (event) {
            .capabilities => |caps| {
                // 绑定键盘
                if (caps.capabilities.keyboard and app.keyboard == null) {
                    app.keyboard = app.seat.?.getKeyboard() catch return;
                    app.keyboard.?.setListener(*App, keyboardListener, app);
                }
                // 绑定鼠标
                if (caps.capabilities.pointer and app.pointer == null) {
                    app.pointer = app.seat.?.getPointer() catch return;
                    app.pointer.?.setListener(*App, pointerListener, app);
                }
            },
            .name => {},
        }
    }

    fn keyboardListener(_: *wl.Keyboard, event: wl.Keyboard.Event, app: *App) void {
        switch (event) {
            .key => |key| {
                if (app.on_key) |cb| cb(app, key.key, @intCast(@intFromEnum(key.state)));
            },
            else => {},
        }
    }

    fn pointerListener(_: *wl.Pointer, event: wl.Pointer.Event, app: *App) void {
        switch (event) {
            .motion => |motion| {
                // wl_fixed_t → 像素坐标
                app.pointer_x = motion.surface_x.toInt();
                app.pointer_y = motion.surface_y.toInt();
            },
            .button => |button| {
                if (button.state == .released) {
                    if (app.on_click) |cb| cb(app, app.pointer_x, app.pointer_y, button.button);
                }
            },
            .axis => |axis| {
                if (app.on_scroll) |cb| cb(app, @intCast(@intFromEnum(axis.axis)), axis.value.toInt());
            },
            else => {},
        }
    }
};
