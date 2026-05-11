# Architecture

Biome is an Electron desktop app that runs AI-generated worlds locally on GPU via a Python-based World Engine server.

## Process Model

There are two distinct "servers" in the architecture — don't confuse them:

1. **Electron main process** (`electron/`): The Node.js backend of the desktop app. Manages the window, settings, file system, and server process lifecycle. The renderer communicates with it over **Electron IPC**.
2. **World Engine server** (`server-components/`): A separate Python process that runs the AI model on GPU and streams frames. The renderer communicates with it over **WebSocket**.

The renderer (`src/`) talks to both: IPC for app operations (settings, window control, engine setup), WebSocket for real-time world streaming.

## Electron IPC (renderer ↔ main process)

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

For the WebSocket side of the architecture (renderer ↔ World Engine), see [WebSocket Protocol](websocket-protocol.md).

## State Management

React Context + hooks, no external state library:

- **SettingsProvider** (`src/hooks/useSettings.tsx`): User settings persistence
- **PortalContext** (`src/context/PortalContext.tsx`): App state machine (MAIN_MENU, LOADING, STREAMING, etc.)
- **StreamingContext** (`src/context/StreamingContext.tsx`): WebSocket connection and streaming lifecycle
- **VortexContext** (`src/context/VortexContext.tsx`): Loading animation renderer

State machines in `src/context/portalStateMachine.ts` and `src/context/streamingLifecycleMachine.ts`.

## Engine Modes: Standalone vs Server

Biome supports two engine modes (`engine_mode` in settings, type `EngineMode`), toggled in the settings UI. **Standalone is the default.**

**Standalone** (`'standalone'`): Biome manages a local Python server process. Setup and launch are handled by the Electron main process (`electron/ipc/engine.ts` and `electron/ipc/server.ts`):

1. **Unpack server components**: The app's `server-components` resource (Python sources, packages, lockfile) is copied into a `world_engine/` directory next to the executable.
2. **Install UV**: The [uv](https://github.com/astral-sh/uv) binary is downloaded from GitHub releases into `.uv/bin/`. All UV state (cache, Python installs, tool dirs) is kept under `.uv/` via env vars so nothing touches the system Python.
3. **Sync dependencies**: `uv sync` in `world_engine/` reads `pyproject.toml`, downloads a managed Python interpreter, creates an isolated `.venv`, and installs all packages.
4. **Start server**: Spawned via `uv run python -u main.py --port {port}`. It auto-assigns a port starting from 7987, polls `/health` until ready, then the renderer connects via `ws://localhost:{port}/ws`.

Process lifecycle is managed by `electron/lib/serverState.ts`. The UI shows engine health status and a "Reinstall" button (`WorldEngineSection`).

**Server** (`'server'`): Biome connects to a pre-existing remote server.

- Uses the user-configured `server_url` setting
- No local process spawning — derives WebSocket URL from `server_url`
- Supports secure transport (`wss://`) when the URL uses HTTPS
- UI shows a "Server URL" text input instead of engine status

Connection flow for both modes is in `src/context/streamingWarmConnection.ts` (`runWarmConnectionFlow`). Mode switching during an active session triggers teardown-and-reconnect in `StreamingContext.tsx` — if switching away from standalone, the local server is stopped.

Communication with the server (in either mode) uses WebSocket RPC (`src/lib/wsRpc.ts`).
