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

    /// 检查 EVENT 帧是否包含指定 topic
    pub fn isEventWithTopic(packet: Packet, topic: []const u8) bool {
        if (packet.type != .EVENT) return false;
        return std.mem.indexOf(u8, packet.payload, topic) != null;
    }

    /// 检查 STREAM_CHUNK 帧是否属于指定订阅
    pub fn isStreamChunkFor(packet: Packet, subscription_id: []const u8) bool {
        if (packet.type != .STREAM_CHUNK) return false;
        return std.mem.indexOf(u8, packet.payload, subscription_id) != null;
    }

    /// 从 STREAM_CHUNK 帧中提取数据段
    /// 返回 payload 中 "data" 字段之后的原始字节（简化解析）
    pub fn extractStreamData(packet: Packet) ?[]const u8 {
        if (packet.type != .STREAM_CHUNK) return null;
        // 查找 "data" 标记后的 bin 格式数据
        const marker = "data";
        const idx = std.mem.indexOf(u8, packet.payload, marker);
        if (idx) |i| {
            const start = i + marker.len;
            if (start >= packet.payload.len) return null;
            // MsgPack bin8: 0xC4 + len(1) + data
            // MsgPack bin16: 0xC5 + len(2) + data
            // MsgPack bin32: 0xC6 + len(4) + data
            const tag_pos = start;
            if (tag_pos >= packet.payload.len) return null;
            const tag = packet.payload[tag_pos];
            if (tag == 0xC4 and tag_pos + 2 < packet.payload.len) {
                const data_len = packet.payload[tag_pos + 1];
                const data_start = tag_pos + 2;
                if (data_start + data_len <= packet.payload.len) {
                    return packet.payload[data_start .. data_start + data_len];
                }
            }
            if (tag == 0xC5 and tag_pos + 3 < packet.payload.len) {
                const data_len = std.mem.readInt(u16, packet.payload[tag_pos + 1 .. tag_pos + 3][0..2], .big);
                const data_start = tag_pos + 3;
                if (data_start + data_len <= packet.payload.len) {
                    return packet.payload[data_start .. data_start + data_len];
                }
            }
        }
        return null;
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
    /// 发送窗口列表变更事件到内核
    /// 编码为 MsgPack EVENT 帧：{ topic: "window.list.changed", windows: [...] }
    pub fn sendWindowListEvent(self: *Client, allocator: std.mem.Allocator, window_titles: []const []const u8, focused_idx: ?usize) !void {
        var payload = std.ArrayList(u8){};
        defer payload.deinit(allocator);

        // { topic: "window.list.changed", windows: [ { title: "...", focused: true/false }, ... ] }
        try encodeMapHeader(&payload, allocator, 2);
        try encodeString(&payload, allocator, "topic");
        try encodeString(&payload, allocator, "window.list.changed");
        try encodeString(&payload, allocator, "windows");

        // 编码数组头
        const count: u8 = @intCast(@min(window_titles.len, 15));
        try payload.append(allocator, 0x90 | count); // fixarray

        for (window_titles[0..count], 0..) |title, i| {
            try encodeMapHeader(&payload, allocator, 2);
            try encodeString(&payload, allocator, "title");
            try encodeString(&payload, allocator, title);
            try encodeString(&payload, allocator, "focused");
            // MsgPack bool: 0xC3 = true, 0xC2 = false
            if (focused_idx != null and focused_idx.? == i) {
                try payload.append(allocator, 0xC3);
            } else {
                try payload.append(allocator, 0xC2);
            }
        }

        // 发送 EVENT 帧
        const len: u32 = @intCast(payload.items.len);
        var header: [8]u8 = undefined;
        std.mem.writeInt(u16, header[0..2], MAGIC, .big);
        header[2] = VERSION;
        header[3] = @intFromEnum(PacketType.EVENT);
        std.mem.writeInt(u32, header[4..8], len, .big);

        try self.stream.writeAll(&header);
        try self.stream.writeAll(payload.items);
    }
};

pub fn encodeMapHeader(list: *std.ArrayList(u8), allocator: std.mem.Allocator, size: u8) !void {
    if (size < 16) {
        try list.append(allocator, 0x80 | size);
    } else {
        return error.MapTooLargeForFixMap;
    }
}

pub fn encodeString(list: *std.ArrayList(u8), allocator: std.mem.Allocator, str: []const u8) !void {
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
