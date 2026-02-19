const std = @import("std");
const posix = std.posix;

// 全局关机标志
var should_shutdown: bool = false;

/// Kairo Init 进程 (PID 1)
/// 负责：信号处理、僵尸进程回收、服务启动、优雅关机
pub fn main() !void {
    std.debug.print("Kairo AgentOS Kernel (v0.1.0) starting...\n", .{});

    // 设置信号处理
    setupSignalHandlers();

    // 启动核心服务
    startServices() catch |err| {
        std.debug.print("Failed to start services: {}\n", .{err});
    };

    std.debug.print("Kairo Init: entering main loop\n", .{});

    // 主循环：回收僵尸进程 + 等待信号
    mainLoop();

    std.debug.print("Kairo Init: shutting down\n", .{});
}

/// 设置 SIGCHLD 和 SIGTERM 信号处理
fn setupSignalHandlers() void {
    // SIGCHLD: 子进程退出时回收僵尸进程
    const chld_act = posix.Sigaction{
        .handler = .{ .handler = handleSigchld },
        .mask = posix.empty_sigset,
        .flags = posix.SA.NOCLDSTOP | posix.SA.RESTART,
    };
    posix.sigaction(posix.SIG.CHLD, &chld_act, null);

    // SIGTERM: 优雅关机
    const term_act = posix.Sigaction{
        .handler = .{ .handler = handleSigterm },
        .mask = posix.empty_sigset,
        .flags = 0,
    };
    posix.sigaction(posix.SIG.TERM, &term_act, null);

    // SIGINT: 同样触发优雅关机
    posix.sigaction(posix.SIG.INT, &term_act, null);

    std.debug.print("Kairo Init: signal handlers installed\n", .{});
}

/// SIGCHLD 处理：回收所有已退出的子进程，防止僵尸进程累积
fn handleSigchld(_: c_int) callconv(.c) void {
    // 循环回收所有已退出的子进程（非阻塞）
    while (true) {
        const result = std.os.linux.waitpid(-1, null, std.os.linux.W.NOHANG);
        if (result == 0 or result == -@as(isize, @intCast(@intFromEnum(std.os.linux.E.CHILD)))) {
            break; // 没有更多子进程需要回收
        }
        if (result < 0) break; // 其他错误
    }
}

/// SIGTERM/SIGINT 处理：设置关机标志
fn handleSigterm(_: c_int) callconv(.c) void {
    should_shutdown = true;
}

/// 启动核心服务（Kairo Session Manager、River Compositor 等）
fn startServices() !void {
    std.debug.print("Kairo Init: starting core services...\n", .{});

    // TODO: 按依赖图启动服务
    // 1. 挂载文件系统（/proc, /sys, /dev）
    // 2. 启动 D-Bus
    // 3. 启动 Kairo Session Manager (bun src/index.ts)
    // 4. 启动 River Compositor
    // 5. 启动 Kairo WM

    std.debug.print("Kairo Init: core services started (stub)\n", .{});
}

/// 主循环：等待信号，回收僵尸进程
fn mainLoop() void {
    while (!should_shutdown) {
        // 使用 pause() 等待信号，避免忙等待
        // pause() 会在收到信号时返回
        _ = std.os.linux.syscall0(.pause);

        // 信号处理器已在 handleSigchld 中回收子进程
        // 这里可以做额外的健康检查
    }

    // 收到关机信号，执行优雅关机
    gracefulShutdown();
}

/// 优雅关机：向所有子进程发送 SIGTERM，等待退出，最后发送 SIGKILL
fn gracefulShutdown() void {
    std.debug.print("Kairo Init: sending SIGTERM to all processes...\n", .{});

    // 向所有进程发送 SIGTERM（PID -1 表示所有进程）
    _ = std.os.linux.kill(-1, posix.SIG.TERM);

    // 等待子进程退出（最多 5 秒）
    var waited: u32 = 0;
    while (waited < 50) : (waited += 1) {
        const result = std.os.linux.waitpid(-1, null, std.os.linux.W.NOHANG);
        if (result == -@as(isize, @intCast(@intFromEnum(std.os.linux.E.CHILD)))) {
            std.debug.print("Kairo Init: all processes exited\n", .{});
            return;
        }
        std.time.sleep(100 * std.time.ns_per_ms); // 100ms
    }

    // 超时，强制终止
    std.debug.print("Kairo Init: timeout, sending SIGKILL to remaining processes...\n", .{});
    _ = std.os.linux.kill(-1, posix.SIG.KILL);

    // 最终回收
    while (true) {
        const result = std.os.linux.waitpid(-1, null, std.os.linux.W.NOHANG);
        if (result <= 0) break;
    }
}
