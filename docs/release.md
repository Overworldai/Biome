# Cutting a Release

```bash
node scripts/release.mjs          # Print current version
node scripts/release.mjs <version> # Bump versions, commit, and tag
```

This updates version numbers across the project, creates a commit, and tags it. Follow the script's output for next steps.

## Release Checklist

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
- [ ] `scene_authoring_enabled`: off by default — when off, the Scene Authoring UI and keybind are hidden; when on, both the edit-existing-scene and generate-from-prompt flows work end-to-end
- [ ] `scene_authoring_save_generated`: on and off — when on, generated scenes are saved to disk for replay
- [ ] `debug_overlays.*`: each of the four overlays individually, then all four at once

**Keybindings**

- [ ] Bind `resetScene` and `sceneEdit` to the same key — conflict warning appears
- [ ] Bind either to a movement / camera key — in-game input remains usable (or the conflict is surfaced)

**Long-session stability** — stream for ~10 minutes, with several prompt changes and at least one model switch. Each of these resets world state, but host resources should not accumulate across resets:

- [ ] Renderer and Python server memory usage stabilises rather than climbing across resets
- [ ] No stray child processes or dangling file handles linger after a model switch
- [ ] Frame generation times stay consistent from the start of the session to the end

**Settings robustness** — with the app closed, mutate the settings file on disk:

- [ ] Delete the file entirely — app boots with all defaults and no error dialog
- [ ] Remove individual fields — Zod defaults fill them in, other fields are preserved
- [ ] Write malformed JSON — app boots and falls back to defaults rather than refusing to start
