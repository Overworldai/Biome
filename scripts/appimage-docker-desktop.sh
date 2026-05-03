#!/usr/bin/env bash
# Test the built AppImage inside a containerised Wayland desktop.
# Uses sway (headless) + wayvnc + noVNC for browser-based access.
#
# Usage:
#   ./scripts/appimage-docker-desktop.sh                  # ubuntu (default)
#   ./scripts/appimage-docker-desktop.sh --distro fedora  # fedora 41
#   ./scripts/appimage-docker-desktop.sh --distro arch    # archlinux
#   ./scripts/appimage-docker-desktop.sh --no-gpu         # skip GPU passthrough
#   ./scripts/appimage-docker-desktop.sh --rebuild        # docker build --no-cache
#   ./scripts/appimage-docker-desktop.sh --port 6080      # change noVNC port
#
# Open http://localhost:6080/ and type `biome` in the terminal.
# Ctrl-C here to stop.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DOCKERFILE="$REPO_ROOT/build/appimage-test/Dockerfile"
DOCKER_CONTEXT="$REPO_ROOT/build/appimage-test"

DISTRO="ubuntu"
USE_GPU=1
REBUILD=0
NOVNC_PORT=6080
VNC_PASSWORD="${VNC_PASSWORD:-biome}"

while [ $# -gt 0 ]; do
  case "$1" in
    --distro)   DISTRO="$2"; shift 2 ;;
    --no-gpu)   USE_GPU=0; shift ;;
    --rebuild)  REBUILD=1; shift ;;
    --port)     NOVNC_PORT="$2"; shift 2 ;;
    -h|--help)  sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Map --distro to Docker base image and distro-family build arg.
case "$DISTRO" in
  ubuntu)  BASE_IMAGE="ubuntu:24.04";      DISTRO_FAMILY="ubuntu" ;;
  fedora)  BASE_IMAGE="fedora:41";          DISTRO_FAMILY="fedora" ;;
  arch)    BASE_IMAGE="archlinux:latest";   DISTRO_FAMILY="arch" ;;
  *) echo "error: unknown distro '$DISTRO' (ubuntu, fedora, arch)" >&2; exit 2 ;;
esac

IMAGE_TAG="biome-appimage-desktop:$DISTRO"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found on PATH" >&2
  exit 1
fi

APPIMAGE_DIR="$REPO_ROOT/out/make/AppImage/x64"
APPIMAGE_PATH="$(ls -t "$APPIMAGE_DIR"/*.AppImage 2>/dev/null | head -1 || true)"
if [ -z "$APPIMAGE_PATH" ]; then
  echo "error: no .AppImage found in $APPIMAGE_DIR — run ./scripts/appimage-docker-build.sh first" >&2
  exit 1
fi
echo "[appimage-desktop] $DISTRO | $(basename "$APPIMAGE_PATH")"

BUILD_FLAGS=(
  --build-arg "BASE_IMAGE=$BASE_IMAGE"
  --build-arg "DISTRO_FAMILY=$DISTRO_FAMILY"
)
[ "$REBUILD" = 1 ] && BUILD_FLAGS+=(--no-cache)
echo "[appimage-desktop] building image $IMAGE_TAG"
docker build "${BUILD_FLAGS[@]}" -f "$DOCKERFILE" -t "$IMAGE_TAG" "$DOCKER_CONTEXT"

LOGS_DIR="$REPO_ROOT/out/appimage-test-out"
mkdir -p "$LOGS_DIR"

DOCKER_FLAGS=(
  --rm -it
  --name biome-appimage-desktop
  -p "127.0.0.1:$NOVNC_PORT:6080"
  -p "127.0.0.1:5900:5900"
  -v "$APPIMAGE_PATH":/shared/Biome.AppImage:ro
  -v "$LOGS_DIR":/out
  -e VNC_PASSWORD="$VNC_PASSWORD"
  -e APPIMAGE_EXTRACT_AND_RUN=1
  --shm-size=2g
  # sway/wlroots needs SYS_NICE for thread priorities. Without it the
  # compositor fails with "Operation not permitted" at startup.
  --cap-add=SYS_NICE
)

# GPU passthrough: prefer CDI (modern NixOS), fall back to legacy --gpus.
if [ "$USE_GPU" = 1 ]; then
  HAS_CDI=0
  for d in /etc/cdi /var/run/cdi; do
    [ -d "$d" ] || continue
    for f in "$d"/*.yaml "$d"/*.json; do
      if [ -e "$f" ]; then HAS_CDI=1; break 2; fi
    done
  done

  if [ "$HAS_CDI" = 1 ]; then
    DOCKER_FLAGS+=(--device nvidia.com/gpu=all)
    echo "[appimage-desktop] GPU via CDI"
  elif docker info 2>/dev/null | grep -q nvidia; then
    DOCKER_FLAGS+=(--gpus all)
    echo "[appimage-desktop] GPU via legacy runtime"
  else
    echo "warning: no CDI spec or nvidia runtime found; running without GPU." >&2
  fi
fi

docker rm -f biome-appimage-desktop >/dev/null 2>&1 || true

cat <<EOF

[appimage-desktop] ready ($DISTRO)
  Browser:  http://localhost:$NOVNC_PORT/
  Terminal: biome
  Logs:     out/appimage-test-out/biome.log
  Ctrl-C to stop.

EOF

exec docker run "${DOCKER_FLAGS[@]}" "$IMAGE_TAG"
