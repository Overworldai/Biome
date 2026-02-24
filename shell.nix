{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    pkg-config
  ];

  buildInputs = with pkgs; [
    glib
    gtk3
    webkitgtk_4_1
    libsoup_3
    openssl
  ];
}
