// 内核 IPC 客户端 — 复用 os/src/wm/ipc.zig 的协议
// 新增 MsgPack 解码器用于解析响应
const std = @import("std");
const net = std.net;
const posix = std.posix;

pub const MAGIC: u16 = 0x4B41;
pub const VERSION: u8 = 1;
pub const SOCKET_PATH = "/run/kairo/kernel.sock";

pub const PacketType = enum(u8) {
    REQUEST = 0x01,
    RESPONSE = 0x02,
    EVENT = 0x03,
    STREAM_CHUNK = 0x04,
};

pub const Packet = struct {
    type: PacketType,
    payload: []u8,
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

    /// 获取底层 fd（用于 poll）
    pub fn getFd(self: *Client) posix.fd_t {
        return self.stream.handle;
    }

    /// 发送 RPC 请求（无参数）
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

        try self.sendPacket(.REQUEST, payload.items);
    }

    /// 读取一个数据包
    pub fn readPacket(self: *Client, allocator: std.mem.Allocator) !?Packet {
        var header: [8]u8 = undefined;
        const n = try self.stream.read(&header);
        if (n == 0) return null;
        if (n < 8) return error.IncompleteHeader;

        const magic = std.mem.readInt(u16, header[0..2], .big);
        if (magic != MAGIC) return error.InvalidMagic;
        if (header[2] != VERSION) return error.UnsupportedVersion;

        const packet_type = std.meta.intToEnum(PacketType, header[3]) catch return error.InvalidPacketType;
        const length = std.mem.readInt(u32, header[4..8], .big);

        const payload = try allocator.alloc(u8, length);
        errdefer allocator.free(payload);

        var total_read: usize = 0;
        while (total_read < length) {
            const n_read = try self.stream.read(payload[total_read..]);
            if (n_read == 0) return error.IncompletePayload;
            total_read += n_read;
        }

        return Packet{ .type = packet_type, .payload = payload };
    }

    /// 发送原始数据包
    fn sendPacket(self: *Client, ptype: PacketType, payload: []const u8) !void {
        const len: u32 = @intCast(payload.len);
        var header: [8]u8 = undefined;
        std.mem.writeInt(u16, header[0..2], MAGIC, .big);
        header[2] = VERSION;
        header[3] = @intFromEnum(ptype);
        std.mem.writeInt(u32, header[4..8], len, .big);

        try self.stream.writeAll(&header);
        try self.stream.writeAll(payload);
    }
};

// === MsgPack 编码 ===

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
        return error.StringTooLong;
    }
    try list.appendSlice(allocator, str);
}

// === MsgPack 简易解码 ===

/// 在 payload 中查找指定 key 对应的字符串值（简化解析）
pub fn findStringValue(payload: []const u8, key: []const u8) ?[]const u8 {
    const idx = std.mem.indexOf(u8, payload, key) orelse return null;
    const val_start = idx + key.len;
    if (val_start >= payload.len) return null;

    const tag = payload[val_start];
    // fixstr (0xA0-0xBF)
    if (tag >= 0xA0 and tag <= 0xBF) {
        const slen: usize = tag & 0x1F;
        const start = val_start + 1;
        if (start + slen <= payload.len) {
            return payload[start .. start + slen];
        }
    }
    // str8 (0xD9)
    if (tag == 0xD9 and val_start + 2 < payload.len) {
        const slen: usize = payload[val_start + 1];
        const start = val_start + 2;
        if (start + slen <= payload.len) {
            return payload[start .. start + slen];
        }
    }
    return null;
}

/// 在 payload 中查找指定 key 后的无符号整数值
pub fn findUintValue(payload: []const u8, key: []const u8) ?u64 {
    const idx = std.mem.indexOf(u8, payload, key) orelse return null;
    const val_start = idx + key.len;
    if (val_start >= payload.len) return null;

    const tag = payload[val_start];
    // positive fixint (0x00-0x7F)
    if (tag <= 0x7F) return tag;
    // uint8 (0xCC)
    if (tag == 0xCC and val_start + 1 < payload.len) {
        return payload[val_start + 1];
    }
    // uint16 (0xCD)
    if (tag == 0xCD and val_start + 2 < payload.len) {
        return std.mem.readInt(u16, payload[val_start + 1 ..][0..2], .big);
    }
    // uint32 (0xCE)
    if (tag == 0xCE and val_start + 4 < payload.len) {
        return std.mem.readInt(u32, payload[val_start + 1 ..][0..4], .big);
    }
    return null;
}
