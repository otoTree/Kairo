const std = @import("std");
const posix = std.posix;

// 全局关机标志
var should_shutdown: bool = false;

// 子进程追踪
const MAX_SERVICES = 16;
var service_pids: [MAX_SERVICES]posix.pid_t = [_]posix.pid_t{0} ** MAX_SERVICES;
var service_count: usize = 0;

/// Kairo Init 进程 (PID 1)
/// 负责：文件系统挂载、信号处理、僵尸进程回收、服务启动编排、优雅关机
pub fn main() !void {
    std.debug.print("Kairo AgentOS Kernel (v0.2.0) starting...\n", .{});

    // 设置信号处理
    setupSignalHandlers();

    // 挂载基础文件系统
    mountFilesystems();

    // 按依赖图启动核心服务
    startServices() catch |err| {
        std.debug.print("Failed to start services: {}\n", .{err});
    };

    std.debug.print("Kairo Init: entering main loop\n", .{});

    // 主循环：回收僵尸进程 + 等待信号
    mainLoop();

    std.debug.print("Kairo Init: shutting down\n", .{});
}

// ============================================================
// 文件系统挂载
// ============================================================

/// 挂载基础文件系统（/proc, /sys, /dev, /tmp）
fn mountFilesystems() void {
    std.debug.print("Kairo Init: mounting filesystems...\n", .{});

    mountOrWarn("proc", "/proc", "proc", 0);
    mountOrWarn("sysfs", "/sys", "sysfs", 0);
    mountOrWarn("devtmpfs", "/dev", "devtmpfs", 0);

    mkdirOrWarn("/dev/pts");
    mountOrWarn("devpts", "/dev/pts", "devpts", 0);

    mkdirOrWarn("/dev/shm");
    mountOrWarn("tmpfs", "/dev/shm", "tmpfs", 0);

    mountOrWarn("tmpfs", "/tmp", "tmpfs", 0);
    mountOrWarn("tmpfs", "/run", "tmpfs", 0);

    std.debug.print("Kairo Init: filesystems mounted\n", .{});
}

/// 安全挂载：失败时仅打印警告，不中断启动
fn mountOrWarn(
    source: [*:0]const u8,
    target: [*:0]const u8,
    fstype: [*:0]const u8,
    flags: u32,
) void {
    const result = std.os.linux.mount(source, target, fstype, flags, 0);
    const errno = std.os.linux.E.init(result);
    if (errno != .SUCCESS and errno != .BUSY) {
        std.debug.print("  Warning: mount {s} on {s} failed\n", .{ source, target });
    }
}

/// 安全创建目录
fn mkdirOrWarn(path_str: [*:0]const u8) void {
    const result = std.os.linux.mkdir(path_str, 0o755);
    _ = result;
}

// ============================================================
// 服务依赖图与启动编排
// ============================================================

/// 服务定义
const ServiceDef = struct {
    name: []const u8,
    argv: []const [*:0]const u8,
    deps: []const []const u8,
    health_file: ?[*:0]const u8 = null,
};

/// 核心服务列表（按依赖关系定义）
const service_defs = [_]ServiceDef{
    .{
        .name = "dbus",
        .argv = &[_][*:0]const u8{ "/usr/bin/dbus-daemon", "--system", "--nofork" },
        .deps = &[_][]const u8{},
        .health_file = "/run/dbus/system_bus_socket",
    },
    .{
        .name = "kairo-kernel",
        .argv = &[_][*:0]const u8{ "/usr/local/bin/bun", "run", "/usr/lib/kairo/src/index.ts" },
        .deps = &[_][]const u8{"dbus"},
        .health_file = "/tmp/kairo-kernel.sock",
    },
    .{
        .name = "river",
        .argv = &[_][*:0]const u8{"/usr/bin/river"},
        .deps = &[_][]const u8{"kairo-kernel"},
    },
    .{
        .name = "kairo-wm",
        .argv = &[_][*:0]const u8{"/usr/lib/kairo/os/zig-out/bin/kairo-wm"},
        .deps = &[_][]const u8{"river"},
    },
};

/// 按依赖图启动核心服务
fn startServices() !void {
    std.debug.print("Kairo Init: starting core services...\n", .{});

    for (service_defs) |svc| {
        // 检查依赖是否已启动
        for (svc.deps) |dep_name| {
            var dep_running = false;
            for (service_defs, 0..) |s, i| {
                if (std.mem.eql(u8, s.name, dep_name) and i < service_count and service_pids[i] != 0) {
                    dep_running = true;
                    break;
                }
            }
            if (!dep_running) {
                std.debug.print("  Warning: dependency '{s}' not running for '{s}'\n", .{ dep_name, svc.name });
            }
        }

        std.debug.print("  Starting service: {s}\n", .{svc.name});

        const pid = std.os.linux.fork();
        if (pid == 0) {
            // 子进程：执行服务
            const err = std.os.linux.execve(svc.argv[0], @ptrCast(svc.argv.ptr), @ptrCast(std.os.environ.ptr));
            _ = err;
            std.os.linux.exit(1);
        } else if (pid > 0) {
            if (service_count < MAX_SERVICES) {
                service_pids[service_count] = @intCast(pid);
                service_count += 1;
            }
            std.debug.print("  Service {s} started (PID: {})\n", .{ svc.name, pid });

            // 等待健康检查文件出现
            if (svc.health_file) |hf| {
                waitForFile(hf, 10);
            } else {
                std.Thread.sleep(500 * std.time.ns_per_ms);
            }
        } else {
            std.debug.print("  Failed to fork for {s}\n", .{svc.name});
        }
    }

    std.debug.print("Kairo Init: core services started\n", .{});
}

/// 等待文件出现（用于健康检查）
fn waitForFile(path_str: [*:0]const u8, timeout_secs: u32) void {
    var waited: u32 = 0;
    while (waited < timeout_secs * 10) : (waited += 1) {
        // 尝试 stat 文件，成功则表示文件存在
        _ = posix.fstatat(posix.AT.FDCWD, std.mem.span(path_str), 0) catch {
            std.Thread.sleep(100 * std.time.ns_per_ms);
            continue;
        };
        std.debug.print("  Health check passed: {s}\n", .{path_str});
        return;
    }
    std.debug.print("  Warning: health check timeout for {s}\n", .{path_str});
}

// ============================================================
// 信号处理
// ============================================================

/// 设置 SIGCHLD 和 SIGTERM 信号处理
fn setupSignalHandlers() void {
    const chld_act = posix.Sigaction{
        .handler = .{ .handler = handleSigchld },
        .mask = posix.sigemptyset(),
        .flags = posix.SA.NOCLDSTOP | posix.SA.RESTART,
    };
    posix.sigaction(posix.SIG.CHLD, &chld_act, null);

    const term_act = posix.Sigaction{
        .handler = .{ .handler = handleSigterm },
        .mask = posix.sigemptyset(),
        .flags = 0,
    };
    posix.sigaction(posix.SIG.TERM, &term_act, null);
    posix.sigaction(posix.SIG.INT, &term_act, null);

    std.debug.print("Kairo Init: signal handlers installed\n", .{});
}

/// SIGCHLD 处理：回收所有已退出的子进程
fn handleSigchld(_: c_int) callconv(.c) void {
    while (true) {
        var status: u32 = 0;
        const result = std.os.linux.waitpid(-1, &status, std.os.linux.W.NOHANG);
        if (result == 0 or result == -@as(isize, @intCast(@intFromEnum(std.os.linux.E.CHILD)))) {
            break;
        }
        if (result < 0) break;
    }
}

/// SIGTERM/SIGINT 处理：设置关机标志
fn handleSigterm(_: c_int) callconv(.c) void {
    should_shutdown = true;
}

// ============================================================
// 主循环与优雅关机
// ============================================================

/// 主循环：等待信号，回收僵尸进程
fn mainLoop() void {
    while (!should_shutdown) {
        // ARM64 没有 pause 系统调用，使用 ppoll 替代
        std.Thread.sleep(std.time.ns_per_s);
    }
    gracefulShutdown();
}

/// 优雅关机：按逆序向服务发送 SIGTERM，等待退出，最后 SIGKILL
fn gracefulShutdown() void {
    std.debug.print("Kairo Init: graceful shutdown starting...\n", .{});

    // 按逆序停止服务
    var i: usize = service_count;
    while (i > 0) {
        i -= 1;
        const pid = service_pids[i];
        if (pid > 0) {
            std.debug.print("  Sending SIGTERM to PID {}\n", .{pid});
            _ = std.os.linux.kill(pid, posix.SIG.TERM);
        }
    }

    // 等待子进程退出（最多 5 秒）
    var waited: u32 = 0;
    while (waited < 50) : (waited += 1) {
        var status: u32 = 0;
        const result = std.os.linux.waitpid(-1, &status, std.os.linux.W.NOHANG);
        if (result == -@as(isize, @intCast(@intFromEnum(std.os.linux.E.CHILD)))) {
            std.debug.print("Kairo Init: all processes exited\n", .{});
            return;
        }
        std.Thread.sleep(100 * std.time.ns_per_ms);
    }

    // 超时，强制终止
    std.debug.print("Kairo Init: timeout, sending SIGKILL...\n", .{});
    _ = std.os.linux.kill(-1, posix.SIG.KILL);

    while (true) {
        var status2: u32 = 0;
        const result = std.os.linux.waitpid(-1, &status2, std.os.linux.W.NOHANG);
        if (result <= 0) break;
    }
}
