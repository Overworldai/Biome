# Build System

Electron Forge with Vite plugin. Three separate Vite configs and tsconfigs:

- **Main** (`vite.main.config.ts` / `tsconfig.main.json`): Node target
- **Preload** (`vite.preload.config.ts` / `tsconfig.preload.json`): Node + DOM
- **Renderer** (`vite.renderer.config.ts` / `tsconfig.json`): DOM target, React + Tailwind

`forge.config.ts` bundles `server-components` and `seeds` as extra resources.

**Local builds**: `npm run build` copies `server-components/` and other extra resource directories verbatim into the installer. Make sure your workspace is clean before building — any untracked files (`.venv`, `__pycache__`, `server.log`, etc.) will be included and can bloat the installer by gigabytes. Production releases should be cut via CI from a clean checkout.

`server-components/uv.lock` **is** tracked and ships in the installer — it's the canonical lockfile (universal across the Linux/x86_64 + Windows/AMD64 environments declared in `[tool.uv].environments`) and standalone mode mirrors it into `world_engine/` alongside `pyproject.toml`. Whenever you change `server-components/pyproject.toml`, regenerate it with `cd server-components && uv lock` and commit both files together; CI runs `uv lock --check` to catch drift.

## Linux AppImage builds

The default AppImage produced by `@reforged/maker-appimage` is a thin wrapper — it relies on the host system having GTK3, X11, NSS, a C toolchain (for Triton's runtime CUDA JIT), and a correctly-configured OpenSSL. In practice, this fails on many distros: OpenSuSE Tumbleweed crashes on OpenSSL config ([#92](https://github.com/Overworldai/Biome/issues/92)), NixOS has none of these at standard FHS paths, and most desktop Linux installs don't ship `gcc`. Our post-processing pipeline turns the bare AppImage into a self-contained bundle that works across distributions.

On Linux, `npm run build` produces an AppImage that is then post-processed by `scripts/appimage-post-make.mjs` (called automatically via Forge's `postMake` hook) into a self-contained bundle. The pipeline:

- **Fetches pinned build tools** — linuxdeploy, linuxdeploy-plugin-gtk, [appimagetool](https://github.com/AppImage/appimagetool), and the [Zig](https://ziglang.org/) toolchain via `scripts/appimage-prepare-assets.mjs` (Forge `generateAssets` hook). SHA256 hashes are pinned; CI refuses unpinned hashes.
- **Bundles ELF deps** — linuxdeploy + plugin-gtk for GTK/X11, plus a second `ldd` pass for libs in linuxdeploy's excludelist (libX11, libxcb, libz, …) so the bundle works on non-FHS layouts (NixOS, Alpine). NSS plugins (`libsoftokn3.so` and friends) are dlopen'd by Chromium and invisible to `ldd`, so they're copied explicitly.
- **Ships a Zig toolchain** — `AppDir/toolchain/` with `cc`/`gcc`/`clang` shims. Triton JIT-compiles CUDA launcher stubs at runtime with `cc` and most user systems don't have one. The shim rewrites `-l:libfoo.so.N` → `-lfoo` to work around zig's lld not supporting the GNU `-l:` extension.
- **Installs an `AppRun` wrapper** (`build/appimage/AppRun`) that sets `LD_LIBRARY_PATH`, `OPENSSL_CONF=/dev/null` (see [Overworldai/Biome#92](https://github.com/Overworldai/Biome/issues/92)), detects the host's `libcuda.so`, exposes the Zig toolchain on `$PATH`, sources linuxdeploy-plugin-gtk hooks, and execs Electron.
- **Re-squashes** the modified AppDir with appimagetool (which also requires `Categories=Game;` and `Icon=biome` in the .desktop entry).

Build-time apt dependencies are listed in `build/appimage/apt-deps.txt`, installed via `build/appimage/setup-build-env.sh` — a single script that sets up the entire Linux build environment (Node.js 20 via NodeSource + apt deps). Both CI and the Docker build image (`build/appimage/Dockerfile`) run this same script, so there's exactly one definition of what the Linux build needs.

**Building the AppImage locally** (requires Docker):

```bash
./scripts/appimage-docker-build.sh           # Build inside an ubuntu-22.04 container
./scripts/appimage-docker-build.sh --rebuild # Force image rebuild (e.g. after changing apt-deps.txt)
```

Output: `out/make/AppImage/x64/Biome-<version>-x64.AppImage`.

**Testing the AppImage** (requires Docker + NVIDIA GPU):

```bash
./scripts/appimage-docker-desktop.sh                  # Ubuntu 24.04 (default)
./scripts/appimage-docker-desktop.sh --distro fedora  # Fedora 41
./scripts/appimage-docker-desktop.sh --distro arch    # Arch Linux
./scripts/appimage-docker-desktop.sh --no-gpu         # Skip GPU passthrough
./scripts/appimage-docker-desktop.sh --rebuild        # Force image rebuild
```

Opens a Wayland desktop (sway + wayvnc + noVNC) at http://localhost:6080/. The AppImage runs in a real Wayland session so Electron uses Ozone-Wayland, matching the default display server on modern Ubuntu/Fedora. Inside the terminal, type `biome` to launch. Logs are written to `out/appimage-test-out/biome.log` on the host. GPU is passed through via CDI on NixOS (`hardware.nvidia-container-toolkit.enable = true`) or via the legacy nvidia runtime on other distros. Bazzite is Fedora-based, so `--distro fedora` covers it.

**Updating pinned tool versions**: null out the SHA256 constant in `scripts/appimage-prepare-assets.mjs`, re-run the script (it logs the new hash), paste it back. CI enforces all hashes are pinned.

**NixOS note**: the AppImage requires `appimage-run` for direct launch on NixOS due to Chromium's DBus init crashing outside a FHS environment. The Docker-based test script avoids this by running inside a real Ubuntu desktop.
