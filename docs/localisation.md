# Localisation

Translations live in `src/i18n/` as TypeScript constant files (`en.ts`, `ja.ts`, `zh.ts`). The i18next module augmentation in `src/i18n/i18next.d.ts` enables **compile-time enforcement** of translation keys — passing an invalid key to `t()` or to any component that accepts a `TranslationKey` is a type error.

## Translation keys

`TranslationKey` (exported from `src/i18n/index.ts`) is the union of all valid dot-separated translation paths (e.g. `'app.buttons.close'`). Use it in component props wherever the value should be a translation key.

## Translated vs Raw components

UI components prefer translation keys by default. Two escape-hatch patterns exist:

- **`Raw*` variants** for components whose primary input is the visible text. `Button` takes `label: TranslationKey`; `RawButton` takes `children: ReactNode` for icons, mixed content, or dynamic strings. Same pattern for `MenuButton` / `SettingsButton`.
- **`raw*` props** on components with multiple text fields. `SettingsSection` takes `description: TranslationKey` and offers `rawDescription: ReactNode` as the escape hatch. Same pattern on `ConfirmModal`, `SettingsSelect`, and similar multi-field components — grep `raw[A-Z]` in `src/components/` for the full set.

Prefer the translated variant. Only reach for `Raw*` / `raw*` when the content genuinely cannot be a single translation key (SVG icons, model names from an API, etc.).

## Casing conventions (English)

- **Discrete UI controls** (section titles, button labels, toggle labels): Title Case.
- **Settings section descriptions**: phrase as a lower-case question to the user (e.g. `'want to compose and modify scenes with text prompts?'`).
- **Helper / hint text and full sentences**: sentence case.
- Other locales follow their own language's conventions — only English-style locales (`en`, `goose`) need Title Case.

## Adding a translation key

1. Add the key to `src/i18n/en.ts` (the source of truth for key structure).
2. Add corresponding translations to every other locale file. If you forget a locale, `tsc` reports `"Property '...' is missing"` (enforced by `KeyShape` in `resources.ts`).

## Adding a language

`LOCALE_DISPLAY_NAMES` in `src/i18n/locales.ts` is the canonical locale registry — `SupportedLocale`, `SUPPORTED_LOCALES`, `LOCALE_OPTIONS`, `AppLocale` are all derived from it.

1. Create `src/i18n/{code}.ts` mirroring `en.ts`, then import it in `src/i18n/resources.ts`.
2. Add an entry to `LOCALE_DISPLAY_NAMES` mapping the code to its native-script name. Insert before `goose` — `goose` stays last in the picker.

`resources` is typed `Record<SupportedLocale, ExpectedShape>`, so `tsc` flags step 2 if step 1 is missed and vice versa. Display names always render in their native script regardless of the current locale.

**Dev shortcut**: in `npm run dev`, press `Ctrl+L` to cycle through `SUPPORTED_LOCALES`.

## Error handling and `TranslatableError`

All user-visible errors should be localised. `TranslatableError` (exported from `src/i18n/index.ts`) is an `Error` subclass that carries a `translationKey` and `translationParams`:

```typescript
import { TranslatableError } from '../i18n'

throw new TranslatableError('app.server.notResponding', { url: 'http://localhost:7987' })
```

`TranslatableError.message` is eagerly resolved at construction time, so existing `err.message` catch sites get localised text automatically.

Rules:

- **Never throw raw English strings** for user-visible errors.
- **Never lose information** when wrapping an unknown error: `new TranslatableError('app.server.fallbackError', { message: err instanceof Error ? err.message : String(err) })`.
- **Use `TranslatableError` as the state type** — `TranslatableError | null`, never `string | TranslatableError | null`.
- **Resolve at the display boundary.** Components that render errors call `t(err.translationKey, { defaultValue: err.translationKey, ...err.translationParams })`. Intermediate layers pass `TranslatableError` through.
- **Server-originated errors** use `message_id` / `error_id` in the WebSocket protocol (see [Server error messages](websocket-protocol.md#server-error-messages)). The client maps these to `RpcError` (RPC) or resolves directly in `useWebSocket.ts` (push).
