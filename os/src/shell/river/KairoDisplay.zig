const std = @import("std");
const wayland = @import("wayland");
const wl = wayland.server.wl;
const wlr = @import("wlroots");
const Server = @import("Server.zig");
const kairo = wayland.server.kairo;

const KairoDisplay = @This();

global: *wl.Global,
server: *Server,

pub fn init(self: *KairoDisplay) !void {
    self.server = @fieldParentPtr("kairo_display", self);
    self.global = try wl.Global.create(
        self.server.wl_server,
        kairo.DisplayV1,
        1,
        *KairoDisplay,
        self,
        bind,
    );
}

fn bind(client: *wl.Client, self: *KairoDisplay, version: u32, id: u32) void {
    const resource = kairo.DisplayV1.create(client, version, id) catch {
        client.postNoMemory();
        return;
    };
    resource.setHandler(*KairoDisplay, handleRequest, handleDestroy, self);
}

fn handleDestroy(resource: *kairo.DisplayV1, _: *KairoDisplay) void {
    _ = resource;
}

fn handleRequest(
    resource: *kairo.DisplayV1,
    request: kairo.DisplayV1.Request,
    self: *KairoDisplay,
) void {
    switch (request) {
        .get_kairo_surface => |args| {
            createKairoSurface(resource, args.id, args.surface, self);
        },
    }
}

fn createKairoSurface(
    display_resource: *kairo.DisplayV1,
    id: u32,
    surface_resource: *wl.Surface,
    self: *KairoDisplay,
) void {
    const client = display_resource.getClient();
    const allocator = std.heap.c_allocator;

    // Create the KairoSurface struct to hold state
    const kairo_surface = allocator.create(KairoSurface) catch {
        client.postNoMemory();
        return;
    };
    errdefer allocator.destroy(kairo_surface);

    const resource = kairo.SurfaceV1.create(client, 1, id) catch {
        client.postNoMemory();
        return;
    };

    // Initialize KairoSurface
    kairo_surface.* = .{
        .server = self.server,
        .surface_resource = surface_resource,
        .resource = resource,
    };

    // Set handler
    resource.setHandler(*KairoSurface, KairoSurface.handleRequest, KairoSurface.handleDestroy, kairo_surface);
}

const KairoSurface = struct {
    server: *Server,
    surface_resource: *wl.Surface,
    resource: *kairo.SurfaceV1,

    fn handleDestroy(resource: *kairo.SurfaceV1, self: *KairoSurface) void {
        _ = resource;
        std.heap.c_allocator.destroy(self);
    }

    fn handleRequest(
        resource: *kairo.SurfaceV1,
        request: kairo.SurfaceV1.Request,
        self: *KairoSurface,
    ) void {
        _ = self;
        switch (request) {
            .commit_ui_tree => |args| {
                // args.json_payload is [:0]const u8
                std.debug.print("KDP: Received UI Tree: {s}\n", .{args.json_payload});
                // TODO: Parse and render
            },
            .destroy => {
                resource.destroy();
            },
        }
    }
};
