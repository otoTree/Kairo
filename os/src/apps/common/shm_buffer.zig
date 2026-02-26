// SHM 双缓冲管理 — memfd_create + mmap + wl_shm_pool
const std = @import("std");
const posix = std.posix;
const wayland = @import("wayland");
const wl = wayland.client.wl;

pub const ShmBuffer = struct {
    wl_buffer: *wl.Buffer,
    data: [*]u32, // ARGB8888 像素指针
    raw_data: []align(4096) u8, // mmap 原始映射
    fd: posix.fd_t,
    width: u32,
    height: u32,
    busy: bool = false, // 合成器正在使用

    pub fn create(shm: *wl.Shm, w: u32, h: u32) !ShmBuffer {
        const stride: i32 = @intCast(w * 4);
        const size: usize = @intCast(stride * @as(i32, @intCast(h)));

        // 创建匿名共享内存
        const fd = try posix.memfd_create("kairo-app", 0);
        errdefer posix.close(fd);
        try posix.ftruncate(fd, @intCast(size));

        // 映射到进程地址空间
        const raw_data = try posix.mmap(
            null,
            size,
            posix.PROT.READ | posix.PROT.WRITE,
            .{ .TYPE = .SHARED },
            fd,
            0,
        );

        // 创建 wl_shm_pool 和 wl_buffer
        const pool = try shm.createPool(fd, @intCast(size));
        defer pool.destroy();
        const buffer = try pool.createBuffer(
            0,
            @intCast(w),
            @intCast(h),
            stride,
            wl.Shm.Format.argb8888,
        );

        return ShmBuffer{
            .wl_buffer = buffer,
            .data = @ptrCast(@alignCast(raw_data.ptr)),
            .raw_data = raw_data,
            .fd = fd,
            .width = w,
            .height = h,
        };
    }

    /// 清空缓冲区为指定颜色
    pub fn clear(self: *ShmBuffer, color: u32) void {
        const total = self.width * self.height;
        var i: usize = 0;
        while (i < total) : (i += 1) {
            self.data[i] = color;
        }
    }

    pub fn destroy(self: *ShmBuffer) void {
        self.wl_buffer.destroy();
        const size: usize = self.width * self.height * 4;
        posix.munmap(@alignCast(self.raw_data.ptr[0..size]));
        posix.close(self.fd);
    }
};

/// 双缓冲管理器
pub const DoubleBuffer = struct {
    buffers: [2]ShmBuffer,
    current: u1 = 0,

    pub fn create(shm: *wl.Shm, w: u32, h: u32) !DoubleBuffer {
        return DoubleBuffer{
            .buffers = .{
                try ShmBuffer.create(shm, w, h),
                try ShmBuffer.create(shm, w, h),
            },
        };
    }

    /// 获取当前可绘制的缓冲区（非 busy 的那个）
    pub fn getDrawable(self: *DoubleBuffer) *ShmBuffer {
        if (!self.buffers[self.current].busy) {
            return &self.buffers[self.current];
        }
        // 当前缓冲区忙，切换到另一个
        self.current ^= 1;
        return &self.buffers[self.current];
    }

    /// 提交后切换缓冲区
    pub fn swap(self: *DoubleBuffer) void {
        self.buffers[self.current].busy = true;
        self.current ^= 1;
    }

    pub fn destroy(self: *DoubleBuffer) void {
        self.buffers[0].destroy();
        self.buffers[1].destroy();
    }
};