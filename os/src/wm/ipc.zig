const std = @import("std");
const net = std.net;
const posix = std.posix;

pub const MAGIC: u16 = 0x4B41;
pub const VERSION: u8 = 1;

pub const PacketType = enum(u8) {
    REQUEST = 0x01,
    RESPONSE = 0x02,
    EVENT = 0x03,
    STREAM_CHUNK = 0x04,
};

pub const Client = struct {
    stream: net.Stream,
    allocator: std.mem.Allocator,

    pub fn connect(allocator: std.mem.Allocator, path: []const u8) !Client {
        const stream = try net.connectUnixSocket(path);
        return Client{
            .stream = stream,
            .allocator = allocator,
        };
    }

    pub fn close(self: *Client) void {
        self.stream.close();
    }

    pub fn sendRequest(self: *Client, id: []const u8, method: []const u8) !void {
        var payload = std.ArrayList(u8){};
        defer payload.deinit(self.allocator);

        try encodeMapHeader(&payload, self.allocator, 3);
        try encodeString(&payload, self.allocator, "id");
        try encodeString(&payload, self.allocator, id);
        try encodeString(&payload, self.allocator, "method");
        try encodeString(&payload, self.allocator, method);
        try encodeString(&payload, self.allocator, "params");
        try encodeMapHeader(&payload, self.allocator, 0);

        // Header
        const len: u32 = @intCast(payload.items.len);
        var header: [8]u8 = undefined;
        std.mem.writeInt(u16, header[0..2], MAGIC, .big);
        header[2] = VERSION;
        header[3] = @intFromEnum(PacketType.REQUEST);
        std.mem.writeInt(u32, header[4..8], len, .big);

        try self.stream.writeAll(&header);
        try self.stream.writeAll(payload.items);
    }

    pub const Packet = struct {
        type: PacketType,
        payload: []u8, // MsgPack data
    };

    pub fn readPacket(self: *Client, allocator: std.mem.Allocator) !?Packet {
        var header: [8]u8 = undefined;
        const n = try self.stream.read(&header);
        if (n == 0) return null; // EOF
        if (n < 8) return error.IncompleteHeader;

        const magic = std.mem.readInt(u16, header[0..2], .big);
        if (magic != MAGIC) return error.InvalidMagic;

        const version = header[2];
        if (version != VERSION) return error.UnsupportedVersion;

        const type_byte = header[3];
        const packet_type = std.meta.intToEnum(PacketType, type_byte) catch return error.InvalidPacketType;

        const length = std.mem.readInt(u32, header[4..8], .big);

        const payload = try allocator.alloc(u8, length);
        errdefer allocator.free(payload);

        var total_read: usize = 0;
        while (total_read < length) {
            const n_read = try self.stream.read(payload[total_read..]);
            if (n_read == 0) return error.IncompletePayload;
            total_read += n_read;
        }

        return Packet{
            .type = packet_type,
            .payload = payload,
        };
    }

    pub fn isAgentActiveEvent(packet: Packet) ?bool {
        if (packet.type != .EVENT) return null;

        // Simple MsgPack scanner looking for "agent.active" topic
        // and "active" key with boolean value.
        // This is not a full parser but sufficient for this specific event.

        const payload = packet.payload;
        if (payload.len < 10) return null;

        // Check if it contains "agent.active" string
        const topic_marker = "agent.active";
        const topic_idx = std.mem.indexOf(u8, payload, topic_marker);
        if (topic_idx == null) return null;

        // Check if it contains "active" key
        const active_marker = "active";
        const active_idx = std.mem.indexOf(u8, payload, active_marker);

        if (active_idx) |idx| {
            // The value should be after the key.
            // "active" is 6 bytes. 0xA6 "active".
            // The value comes after.
            // It might be 0xC2 (false) or 0xC3 (true).
            // We search for C2 or C3 after "active".

            const search_start = idx + active_marker.len;
            if (search_start >= payload.len) return null;

            for (payload[search_start..], 0..) |byte, i| {
                if (byte == 0xC2) return false;
                if (byte == 0xC3) return true;
                // If we see another string marker (0xA0-0xBF), we probably missed it or it's not a boolean.
                // Stop search after a few bytes to avoid false positives.
                if (i > 5) break;
            }
        }

        return null;
    }
};

fn encodeMapHeader(list: *std.ArrayList(u8), allocator: std.mem.Allocator, size: u8) !void {
    if (size < 16) {
        try list.append(allocator, 0x80 | size);
    } else {
        return error.MapTooLargeForFixMap;
    }
}

fn encodeString(list: *std.ArrayList(u8), allocator: std.mem.Allocator, str: []const u8) !void {
    if (str.len < 32) {
        try list.append(allocator, 0xA0 | @as(u8, @intCast(str.len)));
    } else if (str.len < 256) {
        try list.append(allocator, 0xD9);
        try list.append(allocator, @as(u8, @intCast(str.len)));
    } else {
        // Simplified: assuming we don't send huge strings for now
        return error.StringTooLong;
    }
    try list.appendSlice(allocator, str);
}
