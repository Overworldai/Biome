## Commands

```bash
npm run dev          # Start dev server (Electron Forge + Vite hot-reload)
npm run build        # Production build with installers
npm run package      # Package without installers
npm run lint         # Check formatting (Prettier) + type-check (tsc)
npm run lint-fix     # Auto-fix formatting (Prettier) + type-check (tsc) — run after finishing work
```

For the Python server in `server-components/`, run lint and type-check with:

```bash
cd server-components
uvx ruff check .          # Lint
uvx ruff format .         # Auto-format
uvx basedpyright .        # Type-check (strict mode)
```

Both must pass before a commit lands. The configs in `server-components/pyproject.toml`
use a tiered ignore policy — permanent ignores for things outside our control, and
step-tracked ignores annotated with the refactor step that removes them — so each
later commit's job is to delete ignore lines, not add to them.

No test framework is configured.

Run `npm run lint` after every major block of work to catch formatting and type errors early. Use `npm run lint-fix` to auto-fix formatting issues found by the linter.

## Cutting a Release

```bash
node scripts/release.mjs          # Print current version
node scripts/release.mjs <version> # Bump versions, commit, and tag
```

This updates version numbers across the project, creates a commit, and tags it. Follow the script's output for next steps.

### Release Checklist

The goal is to verify that the release behaves reasonably on an arbitrary user system, regardless of what is or isn't already installed globally. At the time of writing, Biome is expected to work on **Linux and Windows with an NVIDIA GPU**; other platforms and GPU vendors are out of scope for functional testing but should still fail gracefully. The compatibility target is not fixed — re-check it when cutting each release.

**Fresh install** — on a clean environment without pre-existing Python, Node, CUDA toolchain, or C compiler (Windows Sandbox; a fresh Ubuntu / Fedora / Arch container via `./scripts/appimage-docker-desktop.sh`):

- [ ] Installer / AppImage launches
- [ ] Standalone mode unpacks `world_engine/`, installs UV + managed Python, runs `uv sync`, and reaches engine-ready without manual intervention
- [ ] First frame streams end-to-end
- [ ] Install / run path contains spaces and/or non-ASCII characters (e.g. `C:\Users\Café\...`) — standalone's `uv sync` and `world_engine/` unpack still work

**Upgrade path** — install the new release on top of a previous version under the same user account:

- [ ] Existing settings load; no reset prompt and no lost fields
- [ ] Previously-downloaded models in the HF cache are reused (no surprise re-download)
- [ ] `.uv/` cache is reused where possible; `uv sync` only re-runs for genuinely changed deps

**Unsupported systems** — on macOS, a non-NVIDIA Linux/Windows host, or a host without a working CUDA driver:

- [ ] The app opens and surfaces a localised, actionable error (no silent hang, no unhandled exception dialog)
- [ ] UI remains responsive; settings can still be opened and exited

**Engine error surfaces** — force server-originated `error` / `warning` push messages (easiest repro: set `engine_model` to a model that won't fit in VRAM to trigger CUDA OOM):

- [ ] Known errors (messages with `message_id`) render using the translated string, with any `{{message}}` detail interpolated
- [ ] Unknown errors (no `message_id`) show the raw `message` text rather than swallowing it
- [ ] After a recoverable error, the UI returns to a usable state without a full app restart

**Models** — each published Waypoint model (`Waypoint-1-Small`, `Waypoint-1.1-Small`, `Waypoint-1.5-1B`, `Waypoint-1.5-1B-360P`) should:

- [ ] Appear in the model picker (populated from the `Overworld/waypoint` HF collection)
- [ ] Download and load successfully on a cold cache
- [ ] Stream at least one frame before any prompt change
- [ ] `DEFAULT_WORLD_ENGINE_MODEL` (in `src/types/settings.ts` and `electron/ipc/models.ts`) points at the flagship model for this release

**Seed images** — test at least one seed from each of the five defaults in `DEFAULT_PINNED_SCENES`.

**Engine modes** — both must work:

- [ ] **Standalone**: cold start, warm restart, "Reinstall" rebuilds `world_engine/` and recovers
- [ ] **Server**: reachable `ws://` and `wss://` endpoints; invalid URL shows an error; unreachable URL does not freeze the UI
- [ ] **Server disconnect recovery**: kill the remote server mid-stream — client surfaces a localised error and reconnects cleanly once the server is back
- [ ] Toggling between modes mid-session stops the local server and reconnects cleanly

**Setting permutations** — toggle each **mid-stream** (not just at startup) to exercise state-machine transitions. Settings live in `src/types/settings.ts`:

- [ ] `engine_quant`: all of `none` / `fp8w8a8` / `intw8a8` — the first `intw8a8` run triggers a long optimisation pass (expected; must not hang the UI)
- [ ] `cap_inference_fps`: on and off
- [ ] `engine_model`: switch between a default model and a custom HF repo; try a private / non-existent repo (surface an error, do not crash)
- [ ] `locale`: `ja` or `zh` (non-Latin), `he` (RTL), `goose` (novelty locale still renders without crashing)
- [ ] `experimental.scene_edit_enabled`: off by default — when off, scene-edit UI and keybind are hidden; when on, the feature works well enough to ship even though it's experimental
- [ ] `debug_overlays.*`: each of the four overlays individually, then all four at once

**Keybindings**

- [ ] Bind `reset_scene` and `scene_edit` to the same key — conflict warning appears
- [ ] Bind either to a movement / camera key — in-game input remains usable (or the conflict is surfaced)

**Long-session stability** — stream for ~10 minutes, with several prompt changes and at least one model switch. Each of these resets world state, but host resources should not accumulate across resets:

- [ ] Renderer and Python server memory usage stabilises rather than climbing across resets
- [ ] No stray child processes or dangling file handles linger after a model switch
- [ ] Frame generation times stay consistent from the start of the session to the end

**Settings robustness** — with the app closed, mutate the settings file on disk:

- [ ] Delete the file entirely — app boots with all defaults and no error dialog
- [ ] Remove individual fields — Zod defaults fill them in, other fields are preserved
- [ ] Write malformed JSON — app boots and falls back to defaults rather than refusing to start

## Running Offline

To reproduce issues tied to missing internet access — and to verify the **Offline Mode** toggle in General Settings — you don't need to unplug your machine. Use a network namespace.

```bash
bwrap --dev-bind / / --unshare-net npm run dev
```

- `--dev-bind / /` keeps the root filesystem visible.
- `--unshare-net` creates an isolated net namespace; bwrap sets up loopback automatically, so `ws://localhost:PORT/ws` (the World Engine WebSocket) still works.

**Before running**, do one full online run so the UV binary under `.uv/`, the Python `.venv`, and the HuggingFace model cache are populated.

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
- `error` / `warning` — error or transient warning message (see [Server error messages](#server-error-messages) below)

**Client→server commands**, sent as fire-and-forget JSON:

- `control` — input (`buttons[]`, `mouse_dx`, `mouse_dy`)
- `pause` / `resume` — pause/resume generation
- `prompt` — set scene prompt
- `prompt_with_seed` — prompt with a seed image (URL or filename)
- `set_initial_seed`, `set_model`, `reset`

**RPC layer** (`src/lib/wsRpc.ts`): For request/response patterns. Client sends `{type, req_id, ...params}`, server replies `{type: 'response', req_id, success, data/error}`. Used via `useWebSocket().request()`.

#### Server error messages

Server `error` and `warning` push messages use **translation keys** so the client can display localised text. The protocol:

```jsonc
// Preferred: known error with a translation key
{"type": "error", "message_id": "app.server.error.serverStartupFailed", "message": "CUDA out of memory"}
// Warning with interpolation params
{"type": "warning", "message_id": "app.server.warning.seedUnsafe", "params": {"filename": "bad.jpg"}}
// Fallback: unknown/dynamic error with no translation key
{"type": "error", "message": "some unexpected exception text"}
```

- `message_id` — a fully-qualified i18n key (e.g. `app.server.error.cudaRecoveryFailed`). The server must send the **full key path** so it's searchable across the codebase.
- `message` — optional raw detail string (e.g. an exception message). When both `message_id` and `message` are present, `message` is forwarded as the `message` interpolation param to the translation key. Keys that want to surface the detail include `{{message}}` in their string (e.g. `serverStartupFailed: 'Server startup failed: {{message}}'`); keys that don't just ignore it. This keeps composed error text explicit per-key.
- `params` — optional interpolation parameters for the translation key (e.g. `{"filename": "seed.jpg"}`).

RPC error responses use the same convention with `error_id` instead of `error`:

```jsonc
{"type": "response", "req_id": "1", "success": false, "error_id": "app.server.error.someKnownError"}
{"type": "response", "req_id": "1", "success": false, "error": "unknown error text"}
```

On the client, `RpcError` (from `src/lib/wsRpc.ts`) carries the `errorId` for consumers to resolve via `t()`.

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

1. **Unpack server components**: Bundled Python files (`pyproject.toml`, `main.py`, `server.py`, etc.) are copied from the app's `server-components` resource into a `world_engine/` directory next to the executable.
2. **Install UV**: The [uv](https://github.com/astral-sh/uv) package manager binary is downloaded from GitHub releases into `.uv/bin/`. All UV state (cache, Python installs, tool dirs) is kept under `.uv/` via env vars (`UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, etc.) so nothing touches the system Python.
3. **Sync dependencies**: `uv sync` is run in `world_engine/`, which reads `pyproject.toml`, downloads a managed Python interpreter, creates an isolated `.venv`, and installs all packages.
4. **Start server**: The server is spawned via `uv run python -u main.py --port {port}` in the `world_engine/` directory. It auto-assigns a port starting from 7987, polls `/health` until the server responds, then connects via `ws://localhost:{port}/ws`.

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

**Linux AppImage builds**: The default AppImage produced by `@reforged/maker-appimage` is a thin wrapper — it relies on the host system having GTK3, X11, NSS, a C toolchain (for Triton's runtime CUDA JIT), and a correctly-configured OpenSSL. In practice, this fails on many distros: OpenSuSE Tumbleweed crashes on OpenSSL config ([#92](https://github.com/Overworldai/Biome/issues/92)), NixOS has none of these at standard FHS paths, and most desktop Linux installs don't ship `gcc`. Our post-processing pipeline turns the bare AppImage into a self-contained bundle that works across distributions.

On Linux, `npm run build` produces an AppImage that is then post-processed by `scripts/appimage-post-make.mjs` (called automatically via Forge's `postMake` hook). The pipeline:

1. **Fetches build tools** (`scripts/appimage-prepare-assets.mjs`, run via Forge `generateAssets` hook): downloads pinned versions of [linuxdeploy](https://github.com/linuxdeploy/linuxdeploy), linuxdeploy-plugin-gtk, [appimagetool](https://github.com/AppImage/appimagetool), and the [Zig](https://ziglang.org/) toolchain into `build/appimage/.cache/` and `build/appimage/toolchain/`. Idempotent; skips assets already present. SHA256 hashes are pinned in the script — CI refuses to proceed without them.
2. **Bundles GTK/X11 deps**: linuxdeploy + plugin-gtk walk the Electron binary's ELF dependencies and copy ~130 shared libraries into the AppDir, with rpath patching.
3. **Bundles transitive closure**: a second pass uses `ldd` to find libs that linuxdeploy's excludelist skipped (libX11, libxcb, libz, etc.) and copies them too. This ensures the AppImage works on distros with non-FHS layouts (NixOS, Alpine).
4. **Bundles NSS plugins**: `libsoftokn3.so` and friends are dlopen'd by Chromium at runtime — invisible to `ldd` — so they're copied explicitly.
5. **Installs Zig toolchain**: Zig is copied into `AppDir/toolchain/` with `cc`/`gcc`/`clang` shim symlinks. Triton JIT-compiles CUDA launcher stubs at runtime with `cc`; most user systems don't have a C toolchain installed, so the AppImage ships one. The shim rewrites `-l:libfoo.so.N` → `-lfoo` to work around zig's lld not supporting the GNU `-l:` extension.
6. **Installs AppRun wrapper** (`build/appimage/AppRun`): replaces the default symlink with a shell script that sets `LD_LIBRARY_PATH` for bundled libs, `OPENSSL_CONF=/dev/null` (see [Overworldai/Biome#92](https://github.com/Overworldai/Biome/issues/92)), detects the host's `libcuda.so` path, exposes the Zig toolchain on `$PATH`, sources linuxdeploy-plugin-gtk hooks, and execs the Electron binary.
7. **Fixes up .desktop entry**: injects `Categories=Game;` and `Icon=biome` (appimagetool requires both).
8. **Re-squashes** the modified AppDir with appimagetool.

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

## Code Style

Prettier with: no semicolons, single quotes, arrow parens always, 120 char width. Configured in `.prettierrc`.

## CSS & Styling

- **Container query units**: All sizing uses `cqh` (preferred) and `cqw`. The app shell has `container-type: size`, so at the same aspect ratio the same content is visible regardless of window size.
- **Design tokens**: Defined in the `@theme` block in `src/css/app.css` — colors, fonts, spacing, radii, and text sizes (all in `cqh`). Runtime JS↔CSS bridge via `:root` custom properties.
- **Tailwind-first**: Prefer Tailwind classes (including arbitrary values like `text-[2.67cqh]`) over new CSS rules. New CSS should only be added for things Tailwind can't express (pseudo-elements, complex animations, `clip-path`). See `@layer components` in `app.css` for existing examples.
- **Shared styles**: `src/styles.ts` exports reusable Tailwind class constants (e.g. `SETTINGS_CONTROL_BASE`, `HEADING_BASE`). `src/transitions.ts` exports Framer Motion variants. Extract shared Tailwind strings into constants and create components for duplicated UI patterns.
- **No rounded corners**: Avoid `rounded-*` classes on UI elements. The design language uses sharp edges throughout. The only exception is functional rounding (e.g. `rounded-full` for circular spinners).
- **Animations**: `src/css/animations.css` for `@keyframes`, `src/css/video-mask.css` for the CRT shutdown effect. Applied via conditional CSS classes.

## Localisation

Translations live in `src/i18n/` as TypeScript constant files (`en.ts`, `ja.ts`, `zh.ts`). The i18next module augmentation in `src/i18n/i18next.d.ts` enables **compile-time enforcement** of translation keys — passing an invalid key to `t()` or to any component that accepts a `TranslationKey` is a type error.

### Translation key type

`TranslationKey` (exported from `src/i18n/index.ts`) is the union of all valid dot-separated translation paths (e.g. `'app.buttons.close'`). Use it in component props wherever the value should be a translation key.

### Translated vs Raw components

UI components **prefer translation keys by default**. Components that accept user-visible text have two variants:

| Translated (default)                       | Raw (escape hatch)                          | When to use Raw                       |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------- |
| `Button` (`label: TranslationKey`)         | `RawButton` (`children: ReactNode`)         | Icons, mixed content, dynamic strings |
| `MenuButton` (`label: TranslationKey`)     | `RawMenuButton` (`children: ReactNode`)     | Same                                  |
| `SettingsButton` (`label: TranslationKey`) | `RawSettingsButton` (`children: ReactNode`) | Same                                  |

Other components use prop-level `raw` prefixes for escape hatches:

| Component               | Translated prop                                                         | Raw escape hatch                      |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `SettingsSection`       | `description: TranslationKey`                                           | `rawDescription: ReactNode`           |
| `SettingsSelect` option | `label: TranslationKey`                                                 | `rawLabel: string`                    |
| `SettingsSelect`        | `customLabel`, `deleteLabel`: `TranslationKey`                          | `rawCustomPrefix: string`             |
| `ConfirmModal`          | `title`, `description`, `confirmLabel`, `cancelLabel`: `TranslationKey` | `descriptionParams` for interpolation |
| `Modal`                 | `title: TranslationKey`                                                 | —                                     |
| `SettingsCheckbox`      | `label: TranslationKey`                                                 | —                                     |
| `SettingsSlider`        | `label: TranslationKey`                                                 | —                                     |
| `SettingsTextInput`     | `placeholder: TranslationKey`                                           | —                                     |
| `SettingsToggle`        | `options[].label: TranslationKey`                                       | —                                     |
| `ServerLogDisplay`      | `title`, `exportActionLabel`: `TranslationKey`                          | —                                     |

**Prefer the translated variant.** Only reach for `Raw*` components or `raw*` props when the content genuinely cannot be a single translation key (e.g. SVG icons as button content, dynamically constructed strings, model names from an API).

### Casing conventions (English)

- **Section titles, button labels, toggle/switch labels, and other discrete UI controls**: Title Case (e.g. `'Save Generated Scenes'`, `'Enable Scene Authoring'`, `'Record Gameplay'`).
- **Settings section descriptions**: phrase as a **lower-case question addressed to the user**, not a statement or label (e.g. `'want to compose and modify scenes with text prompts?'`, `'how loud should things be?'`). The tone is conversational — the title names the thing, the description asks what the user wants to do with it.
- **Other helper/hint text and full sentences**: sentence case with normal punctuation.
- Other locales follow their own language's conventions — only the English-style locales (`en`, `goose`) need Title Case.

### Adding new translation keys

1. Add the key to `src/i18n/en.ts` (the source of truth for key structure)
2. Add corresponding translations to every other locale file (`ja.ts`, `zh.ts`, etc.)
3. Use the key in components — TypeScript will verify it exists
4. If you forget a locale, `tsc` will report a "Property '...' is missing" error (enforced by `KeyShape` in `resources.ts`)

### Adding a new language

`LOCALE_DISPLAY_NAMES` in `src/i18n/locales.ts` is the canonical locale registry — everything else (`SupportedLocale`, `SUPPORTED_LOCALES`, `LOCALE_OPTIONS`, `AppLocale`) is derived from it.

1. Create `src/i18n/{code}.ts` with the same key structure as `en.ts`, then import it in `src/i18n/resources.ts` and add it to the `resources` object.
2. Add an entry to `LOCALE_DISPLAY_NAMES` in `src/i18n/locales.ts` mapping the code to its native-script name. Insert new locales **before** `goose` — `goose` is a novelty/Easter-egg locale and should always be last in the picker.

`resources` is typed `Record<SupportedLocale, ExpectedShape>`, so `tsc` will flag step 2 if step 1 is missed (and vice versa).

Language display names (e.g. "English", "日本語", "中文") are **not** translation keys — they always appear in their native script regardless of the current locale. Only the "System Default" option is translated.

**Dev shortcut**: in dev builds (`npm run dev`), press `Ctrl+L` to cycle through `SUPPORTED_LOCALES` — useful for eyeballing translations without opening Settings. The choice is persisted to the settings file.

### Error handling and `TranslatableError`

All user-visible errors should be localised. `TranslatableError` (exported from `src/i18n/index.ts`) is an `Error` subclass that carries a `translationKey` and `translationParams`:

```typescript
import { TranslatableError } from '../i18n'

throw new TranslatableError('app.server.notResponding', { url: 'http://localhost:7987' })
```

`TranslatableError.message` is eagerly resolved at construction time via `i18n.t()`, so existing `err.message` catch sites get localised text automatically. Consumers with access to `t()` can re-resolve `translationKey` + `translationParams` for the freshest locale.

**Rules:**

- **Never throw raw English strings** for user-visible errors. Use `TranslatableError` with a translation key.
- **Never lose information.** When wrapping an unknown error, preserve the original message:
  ```typescript
  const message = err instanceof Error ? err.message : String(err)
  new TranslatableError('app.server.fallbackError', { message })
  ```
- **Use `TranslatableError` as the state type**, not `string`. Error state should be `TranslatableError | null`, never `string | TranslatableError | null`.
- **Resolve at the display boundary.** Components that display errors call `t(err.translationKey, { defaultValue: err.translationKey, ...err.translationParams })`. Intermediate layers pass `TranslatableError` through without resolving.
- **Server-originated errors** use `message_id` / `error_id` in the WebSocket protocol (see [Server error messages](#server-error-messages)). The client maps these to `RpcError` (for RPC responses) or resolves them directly in `useWebSocket.ts` (for push messages).

## Key Conventions

- Shared utilities in `electron/lib/` (paths, serverState, uv, platform, seeds)
- Custom canvas renderers in `src/lib/` (portalSparksRenderer, vortexRenderer)
