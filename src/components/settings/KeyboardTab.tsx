import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { DEFAULT_KEYBINDINGS, type ControlBindKey, type Keybindings, type Settings } from '../../types/settings'
import { GAME_ACTIONS, getKeybindConflict } from '../../hooks/useGameInput'
import SettingsSection from '../ui/SettingsSection'
import SettingsSlider from '../ui/SettingsSlider'
import Button from '../ui/Button'
import KeybindRow from './KeybindRow'

// Sensitivity slider ↔ raw settings conversion. Raw range matches the Zod
// schema in `settings.ts` (0.1–3.0); the UI exposes this as a 10–100% slider.
const SENSITIVITY_RAW_MIN = 0.1
const SENSITIVITY_RAW_MAX = 3.0
const SENSITIVITY_MENU_MIN = 10
const SENSITIVITY_MENU_MAX = 100
const SENSITIVITY_RAW_SPAN = SENSITIVITY_RAW_MAX - SENSITIVITY_RAW_MIN
const SENSITIVITY_MENU_SPAN = SENSITIVITY_MENU_MAX - SENSITIVITY_MENU_MIN

const sensitivityToMenu = (raw: number): number =>
  Math.round(SENSITIVITY_MENU_MIN + ((raw - SENSITIVITY_RAW_MIN) * SENSITIVITY_MENU_SPAN) / SENSITIVITY_RAW_SPAN)
const sensitivityFromMenu = (menu: number): number =>
  SENSITIVITY_RAW_MIN + ((menu - SENSITIVITY_MENU_MIN) * SENSITIVITY_RAW_SPAN) / SENSITIVITY_MENU_SPAN

const hasCustomKeybindings = (kb: Keybindings): boolean => {
  for (const key of Object.keys(DEFAULT_KEYBINDINGS) as ControlBindKey[]) {
    if (kb[key] !== DEFAULT_KEYBINDINGS[key]) return true
  }
  return false
}

export type KeyboardTabHandle = {
  collectDraft: () => Partial<Settings>
}

type KeyboardTabProps = {
  settings: Settings
  active: boolean
  menuSceneEditEnabled: boolean
  initialMouseSensitivityFallback: number
  onConflictChange: (hasConflict: boolean) => void
}

const KeyboardTab = forwardRef<KeyboardTabHandle, KeyboardTabProps>(
  ({ settings, active, menuSceneEditEnabled, initialMouseSensitivityFallback, onConflictChange }, ref) => {
    const { t } = useTranslation()
    const [menuMouseSensitivity, setMenuMouseSensitivity] = useState(() =>
      sensitivityToMenu(settings.mouse_sensitivity ?? initialMouseSensitivityFallback)
    )
    const [menuKeybindings, setMenuKeybindings] = useState<Keybindings>(() => ({ ...settings.keybindings }))

    /** Keybind actions currently rendered in the UI. Experimental-only actions
     *  (scene edit) vanish from both the render and the conflict pool when the
     *  experimental flag is off — so the user can reuse Q while it's hidden. */
    const visibleKeybindActions = useMemo(
      () => GAME_ACTIONS.filter((a) => a.keyboard !== undefined && (!a.experimental || menuSceneEditEnabled)),
      [menuSceneEditEnabled]
    )

    const hasConflict = useMemo(() => {
      const codes = visibleKeybindActions.map((a) => menuKeybindings[a.keyboard!.bindKey])
      return new Set(codes).size !== codes.length
    }, [visibleKeybindActions, menuKeybindings])

    useEffect(() => {
      onConflictChange(hasConflict)
    }, [hasConflict, onConflictChange])

    useImperativeHandle(
      ref,
      () => ({
        collectDraft: () => ({
          mouse_sensitivity: sensitivityFromMenu(menuMouseSensitivity),
          keybindings: menuKeybindings
        })
      }),
      [menuMouseSensitivity, menuKeybindings]
    )

    return (
      <div className={active ? 'flex flex-col gap-[2.3cqh]' : 'hidden'}>
        <SettingsSection
          title="app.settings.mouseSensitivity.title"
          description="app.settings.mouseSensitivity.description"
        >
          <SettingsSlider
            min={10}
            max={100}
            value={menuMouseSensitivity}
            onChange={setMenuMouseSensitivity}
            label="app.settings.mouseSensitivity.sensitivity"
            suffix={`${menuMouseSensitivity}%`}
          />
        </SettingsSection>

        <SettingsSection title="app.settings.keybindings.title" description="app.settings.keybindings.description">
          {visibleKeybindActions.map((action) => {
            const bindKey = action.keyboard!.bindKey
            const value = menuKeybindings[bindKey]
            const others = visibleKeybindActions
              .filter((other) => other.keyboard!.bindKey !== bindKey)
              .map((other) => ({
                code: menuKeybindings[other.keyboard!.bindKey],
                label: t(`app.settings.controls.labels.${other.id}`, { defaultValue: other.id })
              }))
            const conflict = getKeybindConflict(value, others)
            const warning = conflict ? (
              <Trans
                i18nKey="app.settings.keybindings.conflictWith"
                values={{ other: conflict.otherLabel }}
                components={{ key: <span className="font-bold text-[var(--color-error-bright)]" /> }}
              />
            ) : null
            return (
              <KeybindRow
                key={action.id}
                label={t(`app.settings.controls.labels.${action.id}`, { defaultValue: action.id })}
                value={value}
                onChange={(code) => setMenuKeybindings((prev) => ({ ...prev, [bindKey]: code }))}
                warning={warning}
              />
            )
          })}
          {hasCustomKeybindings(menuKeybindings) && (
            <div className="flex justify-end mt-[0.8cqh]">
              <Button
                variant="secondary"
                autoShrinkLabel
                label="app.settings.keybindings.resetToDefaults"
                className="text-[2cqh] px-[1.4cqh] py-[0.2cqh]"
                onClick={() => setMenuKeybindings({ ...DEFAULT_KEYBINDINGS })}
              />
            </div>
          )}
        </SettingsSection>
      </div>
    )
  }
)

KeyboardTab.displayName = 'KeyboardTab'

export default KeyboardTab
