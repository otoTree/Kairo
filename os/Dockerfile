# Stage 1: Build the Kairo OS Components
FROM alpine:edge AS builder

# Install build dependencies
RUN apk add --no-cache \
    zig \
    git \
    build-base \
    pkgconf \
    wayland-dev \
    wayland-protocols \
    wlroots-dev \
    libinput-dev \
    libevdev-dev \
    libxkbcommon-dev \
    pixman-dev \
    mesa-dev \
    scdoc

WORKDIR /build
COPY . .

# Build binaries for Linux (musl)
# We use --sysroot / to ensure system libraries in /usr/lib are found.
# We remove -Dtarget=x86_64-linux-musl to rely on native host detection (which is x86_64-linux-musl on Alpine)
# or we can keep it but must ensure sysroot is correct.
# Zig's cross-compilation usually ignores host paths, so we MUST specify --sysroot /.
RUN zig build -Doptimize=ReleaseSmall --sysroot /

# Stage 2: Create the RootFS with runtime dependencies
FROM alpine:edge AS rootfs

# Install runtime dependencies matching build dependencies
RUN apk add --no-cache \
    openrc \
    util-linux \
    wayland \
    wlroots \
    libinput \
    libevdev \
    libxkbcommon \
    pixman \
    mesa-dri-gallium \
    eudev \
    seatd

# Setup basic directories
RUN mkdir -p /os/bin /os/dev /os/proc /os/sys /os/tmp /os/etc/init.d /os/usr/bin /os/usr/share

# Copy artifacts from builder
COPY --from=builder /build/zig-out/bin/kairo-init /os/init
COPY --from=builder /build/zig-out/bin/river /os/usr/bin/river
COPY --from=builder /build/zig-out/bin/kairo-wm /os/usr/bin/kairo-wm

# Copy config files
COPY --from=builder /build/src/shell/config/init /os/etc/kairo/init
RUN chmod +x /os/etc/kairo/init

# Final Image (based on alpine to include libs)
FROM alpine:edge
# Copy installed packages from rootfs stage (actually we can just install them here)
RUN apk add --no-cache \
    openrc \
    util-linux \
    wayland \
    wlroots \
    libinput \
    libevdev \
    libxkbcommon \
    pixman \
    mesa-dri-gallium \
    eudev \
    seatd

# Copy our binaries
COPY --from=builder /build/zig-out/bin/kairo-init /init
COPY --from=builder /build/zig-out/bin/river /usr/bin/river
COPY --from=builder /build/zig-out/bin/kairo-wm /usr/bin/kairo-wm
COPY --from=builder /build/src/shell/config/init /etc/kairo/init

# Set executable
RUN chmod +x /etc/kairo/init

CMD ["/init"]
