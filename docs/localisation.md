# Localisation

Translations live in `src/i18n/` as TypeScript constant files (`en.ts`, `ja.ts`, `zh.ts`). The i18next module augmentation in `src/i18n/i18next.d.ts` enables **compile-time enforcement** of translation keys — passing an invalid key to `t()` or to any component that accepts a `TranslationKey` is a type error.

## Translation key type

`TranslationKey` (exported from `src/i18n/index.ts`) is the union of all valid dot-separated translation paths (e.g. `'app.buttons.close'`). Use it in component props wherever the value should be a translation key.

## Translated vs Raw components

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

## Casing conventions (English)

- **Section titles, button labels, toggle/switch labels, and other discrete UI controls**: Title Case (e.g. `'Save Generated Scenes'`, `'Enable Scene Authoring'`, `'Record Gameplay'`).
- **Settings section descriptions**: phrase as a **lower-case question addressed to the user**, not a statement or label (e.g. `'want to compose and modify scenes with text prompts?'`, `'how loud should things be?'`). The tone is conversational — the title names the thing, the description asks what the user wants to do with it.
- **Other helper/hint text and full sentences**: sentence case with normal punctuation.
- Other locales follow their own language's conventions — only the English-style locales (`en`, `goose`) need Title Case.

## Adding new translation keys

1. Add the key to `src/i18n/en.ts` (the source of truth for key structure)
2. Add corresponding translations to every other locale file (`ja.ts`, `zh.ts`, etc.)
3. Use the key in components — TypeScript will verify it exists
4. If you forget a locale, `tsc` will report a "Property '...' is missing" error (enforced by `KeyShape` in `resources.ts`)

## Adding a new language

`LOCALE_DISPLAY_NAMES` in `src/i18n/locales.ts` is the canonical locale registry — everything else (`SupportedLocale`, `SUPPORTED_LOCALES`, `LOCALE_OPTIONS`, `AppLocale`) is derived from it.

1. Create `src/i18n/{code}.ts` with the same key structure as `en.ts`, then import it in `src/i18n/resources.ts` and add it to the `resources` object.
2. Add an entry to `LOCALE_DISPLAY_NAMES` in `src/i18n/locales.ts` mapping the code to its native-script name. Insert new locales **before** `goose` — `goose` is a novelty/Easter-egg locale and should always be last in the picker.

`resources` is typed `Record<SupportedLocale, ExpectedShape>`, so `tsc` will flag step 2 if step 1 is missed (and vice versa).

Language display names (e.g. "English", "日本語", "中文") are **not** translation keys — they always appear in their native script regardless of the current locale. Only the "System Default" option is translated.

**Dev shortcut**: in dev builds (`npm run dev`), press `Ctrl+L` to cycle through `SUPPORTED_LOCALES` — useful for eyeballing translations without opening Settings. The choice is persisted to the settings file.

## Error handling and `TranslatableError`

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
- **Server-originated errors** use `message_id` / `error_id` in the WebSocket protocol (see [Server error messages](websocket-protocol.md#server-error-messages)). The client maps these to `RpcError` (for RPC responses) or resolves them directly in `useWebSocket.ts` (for push messages).
