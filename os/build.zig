const std = @import("std");
const Scanner = @import("wayland").Scanner;

pub fn build(b: *std.Build) void {
    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we do not override the defaults, which
    // means any target is allowed, and the default is native. Other options
    // for restricting supported target set are available.
    const target = b.standardTargetOptions(.{});

    // Standard optimization options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    const optimize = b.standardOptimizeOption(.{});

    // The Kairo Init Process (PID 1)
    const exe = b.addExecutable(.{
        .name = "kairo-init",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });

    // This declares intent for the executable to be installed into the
    // standard location when the user runs the "install" step.
    b.installArtifact(exe);

    // River Compositor
    const river_dep = b.dependency("river", .{
        .target = target,
        .optimize = optimize,
    });
    const river_exe = river_dep.artifact("river");
    b.installArtifact(river_exe);

    // Kairo Window Manager
    const kairo_wm_exe = b.addExecutable(.{
        .name = "kairo-wm",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/wm/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    kairo_wm_exe.linkLibC();
    kairo_wm_exe.addLibraryPath(.{ .cwd_relative = "/usr/lib" });
    kairo_wm_exe.addLibraryPath(.{ .cwd_relative = "/lib" });
    kairo_wm_exe.linkSystemLibrary("wayland-client");

    // 生成 Wayland 代码
    const scanner = Scanner.create(b, .{
        .wayland_xml = b.path("vendor/wayland-core/protocol/wayland.xml"),
        .wayland_protocols = b.path("vendor/wayland-protocols-core"),
    });

    scanner.generate("wl_compositor", 1);
    scanner.generate("wl_shm", 1);
    scanner.addCustomProtocol(b.path("src/shell/protocol/river-window-management-v1.xml"));
    scanner.generate("river_window_manager_v1", 1);
    scanner.addCustomProtocol(b.path("src/shell/protocol/kairo-display-v1.xml"));
    scanner.generate("kairo_display_v1", 2);

    const wayland_module = b.createModule(.{ .root_source_file = scanner.result });
    kairo_wm_exe.root_module.addImport("wayland", wayland_module);

    b.installArtifact(kairo_wm_exe);

    // Run step (for local testing, though this usually fails on Mac for Linux binaries without QEMU)
    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }
    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run_cmd.step);
}
