// WebSocket 客户端 — 手动实现 RFC 6455
// 连接 ws://localhost:3000/ws 与内核通信
const std = @import("std");
const net = std.net;
const posix = std.posix;
const crypto = std.crypto;
const base64 = std.base64;

pub const Frame = struct {
    opcode: Opcode,
    payload: []const u8,
};

pub const Opcode = enum(u4) {
    text = 0x1,
    close = 0x8,
    ping = 0x9,
    pong = 0xA,
    _,
};

pub const WebSocket = struct {
    stream: net.Stream,
    recv_buf: [4096]u8 = undefined,
    allocator: std.mem.Allocator,
    // 帧解析状态（支持非阻塞分段读取）
    parse_state: ParseState = .idle,
    frame_header: [2]u8 = undefined,
    header_read: usize = 0,
    ext_buf: [8]u8 = undefined,
    ext_read: usize = 0,
    ext_need: usize = 0,
    mask_key: [4]u8 = undefined,
    mask_read: usize = 0,
    payload_len: usize = 0,
    payload_read: usize = 0,
    frame_masked: bool = false,
    frame_opcode: Opcode = .text,

    const ParseState = enum {
        idle,
        reading_header,
        reading_ext,
        reading_mask,
        reading_payload,
    };

    /// 连接 WebSocket 服务器
    pub fn connect(
        allocator: std.mem.Allocator,
        host: []const u8,
        port: u16,
        path: []const u8,
    ) !WebSocket {
        // TCP 连接
        const stream = try net.tcpConnectToHost(allocator, host, port);
        errdefer stream.close();

        // 生成随机 Sec-WebSocket-Key
        var key_bytes: [16]u8 = undefined;
        crypto.random.bytes(&key_bytes);
        var key_b64: [24]u8 = undefined;
        _ = base64.standard.Encoder.encode(&key_b64, &key_bytes);

        // HTTP Upgrade 握手
        var req_buf: [512]u8 = undefined;
        const req = std.fmt.bufPrint(&req_buf,
            "GET {s} HTTP/1.1\r\n" ++
            "Host: {s}:{d}\r\n" ++
            "Upgrade: websocket\r\n" ++
            "Connection: Upgrade\r\n" ++
            "Sec-WebSocket-Key: {s}\r\n" ++
            "Sec-WebSocket-Version: 13\r\n" ++
            "\r\n",
            .{ path, host, port, key_b64 },
        ) catch return error.RequestTooLong;

        try stream.writeAll(req);

        // 读取 HTTP 响应（验证 101 状态码）
        var resp_buf: [1024]u8 = undefined;
        const n = try stream.read(&resp_buf);
        if (n < 12) return error.InvalidResponse;
        if (!std.mem.startsWith(u8, resp_buf[0..n], "HTTP/1.1 101")) {
            return error.UpgradeFailed;
        }

        // 握手完成后设为非阻塞（O_NONBLOCK = 0x800 on Linux）
        const flags = posix.fcntl(stream.handle, 3, 0) catch 0; // F_GETFL = 3
        _ = posix.fcntl(stream.handle, 4, flags | 0x800) catch {}; // F_SETFL = 4, O_NONBLOCK = 0x800

        return WebSocket{
            .stream = stream,
            .allocator = allocator,
        };
    }

    /// 获取底层 fd（用于 poll）
    pub fn getFd(self: *WebSocket) posix.fd_t {
        return self.stream.handle;
    }

    /// 非阻塞读取一个 WebSocket 帧
    /// 返回 null 表示数据不完整（需要等待更多数据）
    pub fn readFrame(self: *WebSocket) !?Frame {
        // 状态机：逐步读取帧的各个部分
        if (self.parse_state == .idle or self.parse_state == .reading_header) {
            self.parse_state = .reading_header;
            while (self.header_read < 2) {
                const r = self.stream.read(self.frame_header[self.header_read..2]) catch |err| {
                    if (err == error.WouldBlock) return null;
                    return err;
                };
                if (r == 0) { self.resetParse(); return error.ConnectionClosed; }
                self.header_read += r;
            }
            // 解析帧头
            self.frame_opcode = @enumFromInt(self.frame_header[0] & 0x0F);
            self.frame_masked = (self.frame_header[1] & 0x80) != 0;
            const len7: u64 = self.frame_header[1] & 0x7F;
            if (len7 < 126) {
                self.payload_len = @intCast(len7);
                self.parse_state = if (self.frame_masked) .reading_mask else .reading_payload;
            } else if (len7 == 126) {
                self.ext_need = 2;
                self.ext_read = 0;
                self.parse_state = .reading_ext;
            } else {
                self.ext_need = 8;
                self.ext_read = 0;
                self.parse_state = .reading_ext;
            }
        }

        if (self.parse_state == .reading_ext) {
            while (self.ext_read < self.ext_need) {
                const r = self.stream.read(self.ext_buf[self.ext_read..self.ext_need]) catch |err| {
                    if (err == error.WouldBlock) return null;
                    return err;
                };
                if (r == 0) { self.resetParse(); return error.ConnectionClosed; }
                self.ext_read += r;
            }
            if (self.ext_need == 2) {
                self.payload_len = std.mem.readInt(u16, self.ext_buf[0..2], .big);
            } else {
                const v = std.mem.readInt(u64, self.ext_buf[0..8], .big);
                self.payload_len = @intCast(v);
            }
            self.parse_state = if (self.frame_masked) .reading_mask else .reading_payload;
        }

        if (self.parse_state == .reading_mask) {
            while (self.mask_read < 4) {
                const r = self.stream.read(self.mask_key[self.mask_read..4]) catch |err| {
                    if (err == error.WouldBlock) return null;
                    return err;
                };
                if (r == 0) { self.resetParse(); return error.ConnectionClosed; }
                self.mask_read += r;
            }
            self.parse_state = .reading_payload;
        }

        if (self.parse_state == .reading_payload) {
            if (self.payload_len > self.recv_buf.len) {
                self.resetParse();
                return error.FrameTooLarge;
            }
            while (self.payload_read < self.payload_len) {
                const r = self.stream.read(self.recv_buf[self.payload_read..self.payload_len]) catch |err| {
                    if (err == error.WouldBlock) return null;
                    return err;
                };
                if (r == 0) { self.resetParse(); return error.ConnectionClosed; }
                self.payload_read += r;
            }
            // 解除掩码
            if (self.frame_masked) {
                for (self.recv_buf[0..self.payload_len], 0..) |*b, i| {
                    b.* ^= self.mask_key[i % 4];
                }
            }
            const frame = Frame{
                .opcode = self.frame_opcode,
                .payload = self.recv_buf[0..self.payload_len],
            };
            self.resetParse();
            return frame;
        }

        return null;
    }

    fn resetParse(self: *WebSocket) void {
        self.parse_state = .idle;
        self.header_read = 0;
        self.ext_read = 0;
        self.ext_need = 0;
        self.mask_read = 0;
        self.payload_len = 0;
        self.payload_read = 0;
        self.frame_masked = false;
    }

    /// 发送 text frame（客户端必须 mask）
    pub fn sendText(self: *WebSocket, data: []const u8) !void {
        // 帧头
        var header_buf: [14]u8 = undefined;
        var header_len: usize = 2;
        header_buf[0] = 0x81; // FIN + text opcode
        if (data.len < 126) {
            header_buf[1] = 0x80 | @as(u8, @intCast(data.len));
        } else if (data.len < 65536) {
            header_buf[1] = 0x80 | 126;
            std.mem.writeInt(u16, header_buf[2..4], @intCast(data.len), .big);
            header_len = 4;
        } else {
            header_buf[1] = 0x80 | 127;
            std.mem.writeInt(u64, header_buf[2..10], @intCast(data.len), .big);
            header_len = 10;
        }
        var mask_key: [4]u8 = undefined;
        crypto.random.bytes(&mask_key);
        @memcpy(header_buf[header_len..][0..4], &mask_key);
        header_len += 4;
        try self.stream.writeAll(header_buf[0..header_len]);
        // 发送 masked payload
        var masked_buf: [4096]u8 = undefined;
        var sent: usize = 0;
        while (sent < data.len) {
            const chunk = @min(data.len - sent, masked_buf.len);
            for (0..chunk) |i| {
                masked_buf[i] = data[sent + i] ^ mask_key[(sent + i) % 4];
            }
            try self.stream.writeAll(masked_buf[0..chunk]);
            sent += chunk;
        }
    }

    /// 发送 close frame
    pub fn sendClose(self: *WebSocket) !void {
        const frame = [_]u8{ 0x88, 0x80, 0, 0, 0, 0 };
        try self.stream.writeAll(&frame);
    }

    pub fn close(self: *WebSocket) void {
        self.stream.close();
    }
};
