# Biome

Overworld's local desktop client for running Waypoint world models. Biome installs and connects to a local GPU server to stream interactive AI-generated environments.

## Requirements

- Node.js 18+
- Rust (latest stable)
- A sufficiently powerful NVIDIA GPU; anything from the last 5 years with >=16GB VRAM should be able to run the model, but a 5090 is currently required for playable framerates

## Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Releases

To trigger a new release build:

```bash
# Create and push a version tag
git tag v0.1.0
git push origin v0.1.0
```

This will automatically build the Windows installer and publish it to GitHub Releases. You can also trigger a build manually from the Actions tab using "Run workflow".
