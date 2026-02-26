# Stage 1: Build the Kairo OS Components (Zig)
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
    freetype-dev \
    scdoc

WORKDIR /build
COPY . .

RUN zig build -Doptimize=ReleaseSmall --sysroot /

# Stage 2: Compile kairo-kernel from bundled JS (Bun native compile)
FROM oven/bun:alpine AS bun-builder
COPY dist/kairo-kernel-bundle.js /tmp/kairo-kernel-bundle.js
RUN bun build --compile /tmp/kairo-kernel-bundle.js --outfile /tmp/kairo-kernel

# Stage 3: Final image
FROM alpine:edge
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
    seatd \
    freetype \
    font-dejavu \
    chromium

# Copy our binaries
COPY --from=builder /build/zig-out/bin/kairo-init /init
COPY --from=builder /build/zig-out/bin/river /usr/bin/river
COPY --from=builder /build/zig-out/bin/kairo-wm /usr/bin/kairo-wm
COPY --from=builder /build/zig-out/bin/kairo-brand /usr/bin/kairo-brand
COPY --from=builder /build/zig-out/bin/kairo-agent-ui /usr/bin/kairo-agent-ui
COPY --from=bun-builder /tmp/kairo-kernel /usr/bin/kairo-kernel
COPY --from=builder /build/src/shell/config/init /etc/kairo/init

# Set executable
RUN chmod +x /etc/kairo/init

CMD ["/init"]
