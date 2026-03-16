## Commands

```bash
npm run dev          # Start dev server (Electron Forge + Vite hot-reload)
npm run build        # Production build with installers
npm run package      # Package without installers
npm run lint         # Check formatting (Prettier)
npm run lint-fix     # Auto-fix formatting (Prettier) — run after finishing work
```

No test framework is configured.

## Architecture

Biome is an Electron desktop app that runs AI-generated worlds locally on GPU via a Python-based World Engine server.

### Process Model

There are two distinct "servers" in the architecture — don't confuse them:

1. **Electron main process** (`electron/`): The Node.js backend of the desktop app. Manages the window, settings, file system, and server process lifecycle. The renderer communicates with it over **Electron IPC**.
2. **World Engine server** (`server-components/`): A separate Python process that runs the AI model on GPU and streams frames. The renderer communicates with it over **WebSocket**.

The renderer (`src/`) talks to both: IPC for app operations (settings, window control, engine setup), WebSocket for real-time world streaming.

### Electron IPC (renderer ↔ main process)

Type-safe IPC contract defined in `src/types/ipc.ts`:

- `IpcCommandMap` — renderer→main commands (request/response via `invoke`)
- `IpcEventMap` — main→renderer events (broadcast via `on`)
- All channels use **kebab-case** (e.g. `read-settings`, `start-engine-server`)

Frontend uses typed wrappers in `src/bridge.ts`:

```typescript
const result = await invoke('read-settings')
const unsubscribe = listen('server-ready', callback)
```

IPC handlers are organized one file per domain in `electron/ipc/` (config, models, engine, server, seeds, backgrounds, window).

### WebSocket Protocol (renderer ↔ World Engine)

The renderer connects to the World Engine at `ws(s)://{host}/ws`. All messages are JSON with a `type` field. The protocol has two layers:

**Push messages** (server→client), handled in `useWebSocket.ts`:

- `status` — loading progress (`code`, `stage: {id, label, percent}`); `code: 'ready'` signals the engine is ready
- `frame` — a rendered frame (`data` as base64, `frame_id`, `gen_ms`)
- `log` — server log line
- `error` / `warning` — error or transient warning message

**Client→server commands**, sent as fire-and-forget JSON:

- `control` — input (`buttons[]`, `mouse_dx`, `mouse_dy`)
- `pause` / `resume` — pause/resume generation
- `prompt` — set scene prompt
- `prompt_with_seed` — prompt with a seed image (URL or filename)
- `set_initial_seed`, `set_model`, `reset`

**RPC layer** (`src/lib/wsRpc.ts`): For request/response patterns. Client sends `{type, req_id, ...params}`, server replies `{type: 'response', req_id, success, data/error}`. Used via `useWebSocket().request()`.

### State Management

React Context + hooks, no external state library:

- **SettingsProvider** (`src/hooks/useSettings.tsx`): User settings persistence
- **PortalContext** (`src/context/PortalContext.tsx`): App state machine (MAIN_MENU, LOADING, STREAMING, etc.)
- **StreamingContext** (`src/context/StreamingContext.tsx`): WebSocket connection and streaming lifecycle
- **VortexContext** (`src/context/VortexContext.tsx`): Loading animation renderer

State machines in `src/context/portalStateMachine.ts` and `src/context/streamingLifecycleMachine.ts`.

### Engine Modes: Standalone vs Server

Biome supports two engine modes (`engine_mode` in settings, type `EngineMode`), toggled in the settings UI. **Standalone is the default.**

**Standalone** (`'standalone'`): Biome manages a local Python server process. Setup and launch are handled by the Electron main process (`electron/ipc/engine.ts` and `electron/ipc/server.ts`):

1. **Unpack server components**: Bundled Python files (`pyproject.toml`, `server.py`, etc.) are copied from the app's `server-components` resource into a `world_engine/` directory next to the executable.
2. **Install UV**: The [uv](https://github.com/astral-sh/uv) package manager binary is downloaded from GitHub releases into `.uv/bin/`. All UV state (cache, Python installs, tool dirs) is kept under `.uv/` via env vars (`UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, etc.) so nothing touches the system Python.
3. **Sync dependencies**: `uv sync` is run in `world_engine/`, which reads `pyproject.toml`, downloads a managed Python interpreter, creates an isolated `.venv`, and installs all packages.
4. **Start server**: The server is spawned via `uv run python -u server.py --port {port}` in the `world_engine/` directory. It auto-assigns a port starting from 7987, polls `/health` until the server responds, then connects via `ws://localhost:{port}/ws`.

Process lifecycle is managed by `electron/lib/serverState.ts`. The UI shows engine health status and a "Reinstall" button (`WorldEngineSection`).

**Server** (`'server'`): Biome connects to a pre-existing remote server.

- Uses the user-configured `server_url` setting
- No local process spawning — derives WebSocket URL from `server_url`
- Supports secure transport (`wss://`) when the URL uses HTTPS
- UI shows a "Server URL" text input instead of engine status

Connection flow for both modes is in `src/context/streamingWarmConnection.ts` (`runWarmConnectionFlow`). Mode switching during an active session triggers teardown-and-reconnect in `StreamingContext.tsx` — if switching away from standalone, the local server is stopped.

Communication with the server (in either mode) uses WebSocket RPC (`src/lib/wsRpc.ts`).

### Build System

Electron Forge with Vite plugin. Three separate Vite configs and tsconfigs:

- **Main** (`vite.main.config.ts` / `tsconfig.main.json`): Node target
- **Preload** (`vite.preload.config.ts` / `tsconfig.preload.json`): Node + DOM
- **Renderer** (`vite.renderer.config.ts` / `tsconfig.json`): DOM target, React + Tailwind

`forge.config.ts` bundles `server-components` and `seeds` as extra resources.

**Local builds**: `npm run build` copies `server-components/` and other extra resource directories verbatim into the installer. Make sure your workspace is clean before building — any untracked files (`.venv`, `__pycache__`, `uv.lock`, `server.log`, etc.) will be included and can bloat the installer by gigabytes. Production releases should be cut via CI from a clean checkout.

**Linux builds**: The AppImage maker requires `mksquashfs` (from squashfs-tools) to be on `PATH`. On NixOS, this is provided by `shell.nix`. On Ubuntu/Debian, install `squashfs-tools`.

## Code Style

Prettier with: no semicolons, single quotes, arrow parens always, 120 char width. Configured in `.prettierrc`.

## CSS & Styling

- **Container query units**: All sizing uses `cqh` (preferred) and `cqw`. The app shell has `container-type: size`, so at the same aspect ratio the same content is visible regardless of window size.
- **Design tokens**: Defined in the `@theme` block in `src/css/app.css` — colors, fonts, spacing, radii, and text sizes (all in `cqh`). Runtime JS↔CSS bridge via `:root` custom properties.
- **Tailwind-first**: Prefer Tailwind classes (including arbitrary values like `text-[2.67cqh]`) over new CSS rules. New CSS should only be added for things Tailwind can't express (pseudo-elements, complex animations, `clip-path`). See `@layer components` in `app.css` for existing examples.
- **Shared styles**: `src/styles.ts` exports reusable Tailwind class constants (e.g. `SETTINGS_CONTROL_BASE`, `HEADING_BASE`). `src/transitions.ts` exports Framer Motion variants. Extract shared Tailwind strings into constants and create components for duplicated UI patterns.
- **Animations**: `src/css/animations.css` for `@keyframes`, `src/css/video-mask.css` for the CRT shutdown effect. Applied via conditional CSS classes.

## Key Conventions

- Shared utilities in `electron/lib/` (paths, serverState, uv, platform, seeds)
- Custom canvas renderers in `src/lib/` (portalSparksRenderer, vortexRenderer)
