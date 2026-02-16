const std = @import("std");
const ipc = @import("ipc.zig");
const posix = std.posix;

fn sleep_ms(ms: u64) void {
    const ns = ms * 1_000_000;
    const req = posix.timespec{
        .tv_sec = @intCast(ns / 1_000_000_000),
        .tv_nsec = @intCast(ns % 1_000_000_000),
    };
    _ = posix.nanosleep(&req, null);
}

pub fn main() !void {
    // Use general purpose allocator since we are not linking libc here strictly (or maybe we are by default)
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const ipc_socket_path = "/tmp/kairo-kernel.sock";

    std.debug.print("Connecting to Kernel IPC at {s}...\n", .{ipc_socket_path});

    // Retry loop
    var client_opt: ?ipc.Client = null;
    var attempts: u32 = 0;
    while (attempts < 5) : (attempts += 1) {
        if (ipc.Client.connect(allocator, ipc_socket_path)) |client| {
            client_opt = client;
            break;
        } else |err| {
            std.debug.print("Attempt {} failed: {}\n", .{ attempts + 1, err });
            sleep_ms(1000);
        }
    }

    if (client_opt) |*client| {
        defer client.close();
        std.debug.print("Connected!\n", .{});

        try client.sendRequest("test-1", "system.get_metrics");
        std.debug.print("Request sent!\n", .{});

        // Wait a bit to ensure server receives it before closing
        sleep_ms(100);
    } else {
        std.debug.print("Could not connect after 5 attempts.\n", .{});
        return error.ConnectionFailed;
    }
}
