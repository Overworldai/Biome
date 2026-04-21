#!/bin/sh
# Set up the Linux build environment for the Biome AppImage.
#
# Single source of truth for both:
#   - The Docker build image (calls with stage args for layer caching)
#   - The CI workflow (calls with no args → runs all stages)
#
# Usage:
#   setup-build-env.sh              # all stages (CI)
#   setup-build-env.sh bootstrap    # just ca-certificates, curl, gnupg
#   setup-build-env.sh node         # just Node.js 20 via NodeSource
#   setup-build-env.sh deps         # just AppImage build deps (apt-deps.txt)

set -eu

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
STAGE="${1:-all}"

if [ "$(id -u)" -ne 0 ]; then
  echo "error: must run as root (try: sudo $0)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

run_bootstrap() {
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl gnupg
}

run_node() {
  if ! node --version 2>/dev/null | grep -q '^v20\.'; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y --no-install-recommends nodejs
  fi
}

run_deps() {
  "$SCRIPT_DIR/install-apt-deps.sh"
}

case "$STAGE" in
  all)       run_bootstrap; run_node; run_deps ;;
  bootstrap) run_bootstrap ;;
  node)      run_node ;;
  deps)      run_deps ;;
  *) echo "error: unknown stage '$STAGE' (bootstrap, node, deps)" >&2; exit 2 ;;
esac
