#!/bin/sh
set -eu

# Initialize keyring (Arch Docker images can have stale keys).
pacman-key --init
pacman-key --populate archlinux
pacman -Syu --noconfirm

pacman -S --noconfirm --needed \
  sway wayvnc foot \
  python python-pip \
  mesa xorg-xwayland

# websockify: install via pip (not always in official repos).
pip install --break-system-packages websockify

# noVNC: not in official repos — fetch the release tarball.
NOVNC_VERSION=1.5.0
curl -fsSL "https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.tar.gz" \
  | tar xz -C /opt
ln -sf "/opt/noVNC-${NOVNC_VERSION}" /opt/novnc
ln -sf vnc.html /opt/novnc/index.html

pacman -Scc --noconfirm
