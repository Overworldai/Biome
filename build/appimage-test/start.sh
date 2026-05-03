#!/bin/sh
# Entrypoint for the appimage-test container.
# Starts sway (Wayland, headless) + wayvnc + noVNC websockify bridge.

set -e

VNC_PASSWORD="${VNC_PASSWORD:-biome}"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# sway headless: no physical display or input devices. If a GPU is present
# (CDI passthrough), wlroots uses its EGL; otherwise falls back to pixman.
export WLR_BACKENDS=headless
export WLR_LIBINPUT_NO_DEVICES=1

echo "[appimage-desktop] starting sway (Wayland, headless)"
sway &
SWAY_PID=$!

# Wait for the Wayland socket.
WAYLAND_SOCKET="$XDG_RUNTIME_DIR/wayland-1"
for i in $(seq 1 30); do
  [ -S "$WAYLAND_SOCKET" ] && break
  sleep 0.2
done
if [ ! -S "$WAYLAND_SOCKET" ]; then
  echo "[appimage-desktop] error: sway did not create $WAYLAND_SOCKET" >&2
  exit 1
fi
export WAYLAND_DISPLAY=wayland-1

echo "[appimage-desktop] starting wayvnc on :5900"
wayvnc 0.0.0.0 5900 &
WAYVNC_PID=$!
sleep 1

# noVNC: distro packages put it at /usr/share/novnc; Arch setup fetches
# it to /opt/novnc. Find whichever is present.
NOVNC_DIR=""
for d in /usr/share/novnc /opt/novnc; do
  [ -d "$d" ] && NOVNC_DIR="$d" && break
done
if [ -z "$NOVNC_DIR" ]; then
  echo "[appimage-desktop] warning: noVNC not found; browser access unavailable" >&2
else
  echo "[appimage-desktop] starting noVNC websockify on 6080"
  websockify --web "$NOVNC_DIR" 6080 localhost:5900 &
fi
WEBSOCKIFY_PID=$!

cat <<EOF

[appimage-desktop] desktop ready (Wayland via sway).
  noVNC (browser): http://localhost:6080/
  Direct VNC:      vnc://localhost:5900

  Inside the terminal, run:  biome
  Logs: /out/biome.log (host: out/appimage-test-out/)

EOF

wait "$SWAY_PID" "$WEBSOCKIFY_PID" "$WAYVNC_PID" 2>/dev/null || true
