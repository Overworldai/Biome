{ pkgs ? import <nixpkgs> {} }:

let
  electronDeps = with pkgs; [
    glib
    nss
    nspr
    atk
    cups
    dbus
    libdrm
    gtk3
    pango
    cairo
    xorg.libX11
    xorg.libXcomposite
    xorg.libXdamage
    xorg.libXext
    xorg.libXfixes
    xorg.libXrandr
    xorg.libxcb
    mesa
    libgbm
    libGL
    libxkbcommon
    expat
    alsa-lib
    at-spi2-atk
    at-spi2-core
    xorg.libxshmfence
  ];
in
pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    pkg-config
  ];

  buildInputs = electronDeps;

  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath (electronDeps ++ [
    pkgs.stdenv.cc.cc.lib    # libstdc++.so.6 (needed by PyTorch native extensions)
    "/run/opengl-driver"     # libcuda.so, libnvidia-ml.so (NVIDIA driver)
  ]);

  # Triton calls /sbin/ldconfig to find libcuda.so, which doesn't exist on NixOS.
  # Point it directly at the driver library path instead.
  TRITON_LIBCUDA_PATH = "/run/opengl-driver/lib";
}
