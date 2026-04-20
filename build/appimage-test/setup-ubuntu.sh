#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  sway wayvnc foot \
  novnc websockify \
  dbus-x11 gnome-terminal nautilus \
  libgl1 mesa-utils xwayland ca-certificates
ln -sf vnc.html /usr/share/novnc/index.html
apt-get clean
rm -rf /var/lib/apt/lists/*
