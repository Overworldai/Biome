#!/bin/sh
set -eu
dnf install -y \
  sway wayvnc foot \
  novnc python3-websockify \
  dbus-x11 gnome-terminal nautilus \
  mesa-libGL mesa-demos xorg-x11-server-Xwayland
ln -sf vnc.html /usr/share/novnc/index.html
dnf clean all
