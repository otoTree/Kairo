#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KAIRO_DIR="$(dirname "$SCRIPT_DIR")"

# 1. Bundle kairo-kernel TS 源码为单个 JS 文件（宿主机 bun）
echo "Bundling kairo-kernel..."
cd "$KAIRO_DIR"
bun build src/index.ts --outfile os/dist/kairo-kernel-bundle.js --target=bun
cd "$SCRIPT_DIR"

# 2. Build Docker image (Zig binaries + bun compile kairo-kernel)
echo "Building Docker image..."
docker build -t kairo-os-builder .

# 3. Extract artifacts
echo "Extracting artifacts..."
id=$(docker create kairo-os-builder)
docker cp $id:/init ./dist/init
docker cp $id:/usr/bin/river ./dist/river
docker cp $id:/usr/bin/kairo-wm ./dist/kairo-wm
docker cp $id:/usr/bin/kairo-brand ./dist/kairo-brand
docker cp $id:/usr/bin/kairo-agent-ui ./dist/kairo-agent-ui
docker cp $id:/usr/bin/kairo-kernel ./dist/kairo-kernel
docker rm -v $id

echo "Build complete! Artifacts are in os/dist/"
