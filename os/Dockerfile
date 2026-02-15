# Stage 1: Build the Zig Init Process
FROM alpine:edge AS builder
RUN apk add --no-cache zig
WORKDIR /build
COPY . .
# Build static binary for Linux (musl)
RUN zig build -Dtarget=x86_64-linux-musl -Doptimize=ReleaseSmall

# Stage 2: Create the Minimal RootFS
FROM alpine:edge AS rootfs
RUN apk add --no-cache openrc util-linux
# Setup basic directories
RUN mkdir -p /os/bin /os/dev /os/proc /os/sys /os/tmp /os/etc/init.d

# Copy our custom init
COPY --from=builder /build/zig-out/bin/kairo-init /os/init

# Configure OpenRC (optional, if we use it)
# RUN rc-update add devfs boot
# RUN rc-update add procfs boot
# RUN rc-update add sysfs boot

# Final Image (just holds the rootfs tarball)
FROM scratch
COPY --from=rootfs /os /
