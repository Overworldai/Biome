#!/bin/sh
# Install Biome AppImage build dependencies from apt-deps.txt.
# Idempotent; re-runs apt-get update + install.
#
# Invokes sudo only if not already root — lets the same script drop into
# CI runners (which need sudo) and Docker containers (which run as root).

set -eu

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DEPS_FILE="$SCRIPT_DIR/apt-deps.txt"

if [ ! -r "$DEPS_FILE" ]; then
  echo "error: cannot read $DEPS_FILE" >&2
  exit 1
fi

# Collect package names (strip comments and blank lines).
PACKAGES="$(grep -vE '^\s*(#|$)' "$DEPS_FILE" | tr '\n' ' ')"

if [ -z "$PACKAGES" ]; then
  echo "error: no packages listed in $DEPS_FILE" >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update
# shellcheck disable=SC2086 # intentional word-splitting of PACKAGES
$SUDO apt-get install -y --no-install-recommends $PACKAGES
