#!/bin/sh
set -e

# Build the Docker image
echo "Building Docker image..."
docker build -t kairo-os-builder .

# Create a container to extract artifacts
echo "Extracting artifacts..."
id=$(docker create kairo-os-builder)
docker cp $id:/init ./dist/init
docker cp $id:/usr/bin/river ./dist/river
docker cp $id:/usr/bin/kairo-wm ./dist/kairo-wm
docker rm -v $id

echo "Build complete! Artifacts are in os/dist/"
