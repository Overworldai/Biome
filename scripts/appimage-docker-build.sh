#!/usr/bin/env bash
# Build the Biome AppImage inside a Docker container that mirrors the
# GitHub Actions environment (ubuntu-22.04 + Node 20 + the shared apt
# package list from build/appimage/apt-deps.txt).
#
# Output lands in ./out/make/ on the host (same path as `npm run build`).
#
# Usage:
#   ./scripts/appimage-docker-build.sh           # build with cached image
#   ./scripts/appimage-docker-build.sh --rebuild # force docker build --no-cache

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_TAG="biome-appimage-builder:ubuntu-22.04"
DOCKERFILE="$REPO_ROOT/build/appimage/Dockerfile"

BUILD_FLAGS=()
for arg in "$@"; do
  case "$arg" in
    --rebuild) BUILD_FLAGS+=(--no-cache) ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found on PATH" >&2
  exit 1
fi

echo "[docker-build] building image $IMAGE_TAG"
docker build \
  "${BUILD_FLAGS[@]}" \
  -f "$DOCKERFILE" \
  -t "$IMAGE_TAG" \
  "$REPO_ROOT"

echo "[docker-build] running build inside container"
# Notes on flags:
#   -u $UID:$GID          run as host user so out/ and build/appimage/.cache/
#                         stay owned by the invoker, not root.
#   -e HOME=/tmp/home     npm, npx, uv etc. need a writable HOME; /tmp/home
#                         is created at run time inside the container.
#   --init                reap zombie processes (node-gyp, electron-rebuild).
docker run --rm \
  --init \
  -u "$(id -u):$(id -g)" \
  -e HOME=/tmp/home \
  -e CI=1 \
  -v "$REPO_ROOT":/workspace \
  -w /workspace \
  "$IMAGE_TAG" \
  bash -c 'mkdir -p /tmp/home && npm ci && npm run build'

echo "[docker-build] done."
echo "artifacts:"
find "$REPO_ROOT/out/make" -maxdepth 4 -name '*.AppImage' -print 2>/dev/null || true
