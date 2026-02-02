<div align="center">

<img src="app-icon.png" width="128" height="128">

# Biome

  **Explore AI-generated worlds in real-time, running locally on your GPU.**

  [![Website](https://img.shields.io/badge/over.world-000000?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48bGluZSB4MT0iMiIgeTE9IjEyIiB4Mj0iMjIiIHkyPSIxMiIvPjxwYXRoIGQ9Ik0xMiAyYTE1LjMgMTUuMyAwIDAgMSA0IDEwIDE1LjMgMTUuMyAwIDAgMS00IDEwIDE1LjMgMTUuMyAwIDAgMS00LTEwIDE1LjMgMTUuMyAwIDAgMSA0LTEweiIvPjwvc3ZnPg==)](https://over.world)
  [![Discord](https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white)](https://discord.gg/overworld)
  [![X](https://img.shields.io/badge/X-000000?logo=x&logoColor=white)](https://x.com/overworld_ai)
  [![Windows](https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white)](https://github.com/Overworldai/Biome/releases)
  [![Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)](https://github.com/Overworldai/Biome/releases)
  [![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

  <img src="assets/launch_grid.gif" width="600">

  **[Download the latest release](https://github.com/Overworldai/Biome/releases/latest)**

</div>

## Overview

Biome is Overworld's desktop client for running [Waypoint world models](https://github.com/Overworldai/world_engine) — a series of **60 FPS, sub-20ms latency**, real-time world models that generate interactive environments **entirely on your local GPU**. Walk around, look in any direction, and watch the world unfold frame by frame.

Biome installs just like a video game — download, run the installer, and start exploring new worlds.

## Features

- Real-time AI-generated environments at playable framerates
- Runs locally on your GPU via [World Engine](https://github.com/Overworldai/world_engine)
- Lightweight native desktop application


## Getting Started

Grab the installer from the [Releases](https://github.com/Overworldai/Biome/releases/latest) page and you're good to go.

**GPU Requirements:** One NVIDIA GPU with 16GB+ VRAM. Most cards from the last 5 years will run the model, though minimally a 5090 is recommended for the smoothest experience. Don't have a powerful enough GPU? Try [Overworld.stream](https://overworld.stream) instead!

## Building from Source

If you want to hack on Biome yourself, you'll need:

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)

```bash

git clone https://github.com/Wayfarer-Labs/Biome.git
cd Biome
npm install

# Development mode with hot-reload
npm run tauri dev

# Production build
npm run tauri build

# On Linux, if the AppImage build fails during stripping, set:
NO_STRIP=true npm run tauri build
```

> **Note (Linux):** The AppImage bundling step may fail with _"failed to bundle project: failed to run linuxdeploy"_. Setting `NO_STRIP=true` skips binary stripping and can resolve this. See [tauri-apps/tauri#13113](https://github.com/tauri-apps/tauri/issues/13113) for details.

## Releases

Releases are automated via GitHub Actions. To trigger a new release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## License

GPL-3.0 — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built by <a href="https://over.world">Overworld</a></sub>
</div>
