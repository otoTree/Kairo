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
    scanner.addCustomProtocol(b.path("src/shell/protocol/river-layer-shell-v1.xml"));
    scanner.generate("river_layer_shell_v1", 1);
    scanner.addCustomProtocol(b.path("src/shell/protocol/kairo-display-v1.xml"));
    scanner.generate("kairo_display_v1", 2);

    // 原生应用需要的协议（xdg-shell + wl_seat）
    scanner.addSystemProtocol("stable/xdg-shell/xdg-shell.xml");
    scanner.generate("xdg_wm_base", 2);
    scanner.generate("wl_seat", 7);

    const wayland_module = b.createModule(.{ .root_source_file = scanner.result });
    kairo_wm_exe.root_module.addImport("wayland", wayland_module);

    b.installArtifact(kairo_wm_exe);

    // === 共享 common 模块 ===
    const draw_mod = b.createModule(.{ .root_source_file = b.path("src/apps/common/draw.zig") });
    const colors_mod = b.createModule(.{ .root_source_file = b.path("src/apps/common/colors.zig") });
    const shm_buffer_mod = b.createModule(.{
        .root_source_file = b.path("src/apps/common/shm_buffer.zig"),
        .imports = &.{.{ .name = "wayland", .module = wayland_module }},
    });
    const wayland_client_mod = b.createModule(.{
        .root_source_file = b.path("src/apps/common/wayland_client.zig"),
        .imports = &.{
            .{ .name = "wayland", .module = wayland_module },
            .{ .name = "shm_buffer", .module = shm_buffer_mod },
        },
    });
    const text_render_mod = b.createModule(.{
        .root_source_file = b.path("src/apps/common/text_render.zig"),
        .imports = &.{.{ .name = "draw", .module = draw_mod }},
        .target = target,
        .link_libc = true,
    });
    text_render_mod.linkSystemLibrary("freetype2", .{});
    const ipc_client_mod = b.createModule(.{ .root_source_file = b.path("src/apps/common/ipc_client.zig") });

    // kairo-brand 品牌展示应用（原生 Wayland 客户端）
    const kairo_brand_exe = b.addExecutable(.{
        .name = "kairo-brand",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/apps/brand/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    kairo_brand_exe.linkLibC();
    kairo_brand_exe.addLibraryPath(.{ .cwd_relative = "/usr/lib" });
    kairo_brand_exe.addLibraryPath(.{ .cwd_relative = "/lib" });
    kairo_brand_exe.linkSystemLibrary("wayland-client");
    kairo_brand_exe.linkSystemLibrary("freetype2");
    kairo_brand_exe.root_module.addImport("wayland", wayland_module);
    kairo_brand_exe.root_module.addImport("wayland_client", wayland_client_mod);
    kairo_brand_exe.root_module.addImport("draw", draw_mod);
    kairo_brand_exe.root_module.addImport("colors", colors_mod);
    kairo_brand_exe.root_module.addImport("text_render", text_render_mod);
    kairo_brand_exe.root_module.addImport("ipc_client", ipc_client_mod);
    b.installArtifact(kairo_brand_exe);

    // kairo-agent-ui Agent 窗口应用（原生 Wayland 客户端）
    const kairo_agent_exe = b.addExecutable(.{
        .name = "kairo-agent-ui",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/apps/agent/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    kairo_agent_exe.linkLibC();
    kairo_agent_exe.addLibraryPath(.{ .cwd_relative = "/usr/lib" });
    kairo_agent_exe.addLibraryPath(.{ .cwd_relative = "/lib" });
    kairo_agent_exe.linkSystemLibrary("wayland-client");
    kairo_agent_exe.linkSystemLibrary("freetype2");
    kairo_agent_exe.root_module.addImport("wayland", wayland_module);
    kairo_agent_exe.root_module.addImport("wayland_client", wayland_client_mod);
    kairo_agent_exe.root_module.addImport("draw", draw_mod);
    kairo_agent_exe.root_module.addImport("colors", colors_mod);
    kairo_agent_exe.root_module.addImport("text_render", text_render_mod);
    b.installArtifact(kairo_agent_exe);

    // Run step (for local testing, though this usually fails on Mac for Linux binaries without QEMU)
    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }
    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run_cmd.step);
}
