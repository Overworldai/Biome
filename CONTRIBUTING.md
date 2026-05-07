# Contributing to Biome

Biome is an Electron desktop app that runs AI-generated worlds locally on GPU via a Python-based World Engine server.

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
uvx ruff format .         # Auto-format (also: --check to verify without rewriting)
uvx ruff check --fix .    # Auto-fix lint issues where ruff has a safe rewrite
uvx basedpyright .        # Type-check (strict mode)
uv lock --check           # Verify uv.lock is in sync with pyproject.toml
```

All must pass before a commit lands. The typed Pydantic boundaries in `server/protocol.py` and the `Connection` invariants in `server/session/` are what we rely on to catch real semantic errors.

No test framework is configured.

## Python Style

### Suppressions strategy

`pyproject.toml` carries **zero project-wide ruff or basedpyright suppressions** — every silenced lint/type report is scoped to the line or file that triggers it, so a new violation in pure-Python code surfaces under strict mode. Three layers, in order of preference:

1. **Fix the underlying issue.** Narrow `except Exception` to the actual raisers (`OSError`, `pydantic.ValidationError`, `binascii.Error`, etc.); add a `_require_X()` helper instead of repeating `if self._x is None: raise` (see `WorldEngineManager._require_engine`); hoist module-level loops into a function so cleanup vars don't leak; replace `try/except/pass` with `contextlib.suppress(...)`.
2. **Per-line ignore.** `# noqa: BLE001  -- <reason>` for ruff, `# pyright: ignore[reportXxx]  -- <reason>` for basedpyright. The trailing `-- <reason>` is required — ruff and pyright both ignore everything after the rule, but future readers shouldn't have to guess. Stack both on one line if needed: `# noqa: BLE001  # pyright: ignore[reportUnusedExcept]  -- ...`.
3. **Per-file pragma.** `# pyright: reportUnknownMemberType=none, ...` at the top of the module (after the docstring). Only for files that touch torch / `world_engine` / diffusers / transformers / `llama_cpp` / pynvml / `py-cpuinfo` — third-party libs whose stubs are partial or absent. Add a rule to the pragma only if it fires on third-party type leakage; never to silence a real local issue. Ruff has no equivalent — use per-line `# noqa` everywhere.

### Concrete exception classes

Ruff's `TRY003` flags long messages passed to bare `RuntimeError` / `ValueError`. Define a typed subclass in the same module instead (e.g. `EngineNotLoadedError` in `engine/manager.py`, `VlmToolCallRetryError` in `engine/vlm.py`). The class owns the message and (where useful) carries structured payload fields the catch site can inspect.

### FastAPI dependencies

Use `Annotated[T, Depends(fn)]` rather than `T = Depends(fn)` for route parameters — the latter trips `B008` (function call in default arg). See `server/routes.py` for the pattern.

## Code Style

Prettier with: no semicolons, single quotes, arrow parens always, 120 char width. Configured in `.prettierrc`.

## CSS & Styling

- **Container query units**: All sizing uses `cqh` (preferred) and `cqw`. The app shell has `container-type: size`, so at the same aspect ratio the same content is visible regardless of window size.
- **Design tokens**: Defined in the `@theme` block in `src/css/app.css` — colors, fonts, spacing, radii, and text sizes (all in `cqh`). Runtime JS↔CSS bridge via `:root` custom properties.
- **Tailwind-first**: Prefer Tailwind classes (including arbitrary values like `text-[2.67cqh]`) over new CSS rules. New CSS should only be added for things Tailwind can't express (pseudo-elements, complex animations, `clip-path`). See `@layer components` in `app.css` for existing examples.
- **Shared styles**: `src/styles.ts` exports reusable Tailwind class constants (e.g. `SETTINGS_CONTROL_BASE`, `HEADING_BASE`). `src/transitions.ts` exports Framer Motion variants. Extract shared Tailwind strings into constants and create components for duplicated UI patterns.
- **No rounded corners**: Avoid `rounded-*` classes on UI elements. The design language uses sharp edges throughout. The only exception is functional rounding (e.g. `rounded-full` for circular spinners).
- **Animations**: `src/css/animations.css` for `@keyframes`, `src/css/video-mask.css` for the CRT shutdown effect. Applied via conditional CSS classes.

## Details

- [Logging](docs/logging.md) — structured logging on both sides, exceptions, formats
- [Localisation](docs/localisation.md) — translation keys, locales, `TranslatableError`

## Architecture

- [Architecture](docs/architecture.md) — process model, IPC, state, engine modes
- [WebSocket Protocol](docs/websocket-protocol.md) — handshake, push/RPC messages, codegen, drift gates
- [Build System](docs/build-system.md) — Forge + Vite, lockfile, AppImage pipeline

## Releases & ops

- [Cutting a Release](docs/release.md) — release script and manual checklist
- [Running Offline](docs/offline.md) — `bwrap` network namespace
