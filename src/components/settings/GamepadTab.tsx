import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GAME_ACTIONS } from '../../hooks/useGameInput'
import type { Settings } from '../../types/settings'
import SettingsSection from '../ui/SettingsSection'
import SettingsSlider from '../ui/SettingsSlider'
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

export type GamepadTabHandle = {
  collectDraft: () => Partial<Settings>
}

type GamepadTabProps = {
  settings: Settings
  active: boolean
  gamepadConnected: boolean
  menuSceneEditEnabled: boolean
  initialSensitivityFallback: number
}

const GamepadTab = forwardRef<GamepadTabHandle, GamepadTabProps>(
  ({ settings, active, gamepadConnected, menuSceneEditEnabled, initialSensitivityFallback }, ref) => {
    const { t } = useTranslation()
    const [menuGamepadSensitivity, setMenuGamepadSensitivity] = useState(() =>
      sensitivityToMenu(settings.gamepad_sensitivity ?? initialSensitivityFallback)
    )

    useImperativeHandle(
      ref,
      () => ({
        collectDraft: () => ({
          gamepad_sensitivity: sensitivityFromMenu(menuGamepadSensitivity)
        })
      }),
      [menuGamepadSensitivity]
    )

    return (
      <div className={active ? 'flex flex-col gap-[2.3cqh]' : 'hidden'}>
        <SettingsSection
          title="app.settings.gamepadSensitivity.title"
          description="app.settings.gamepadSensitivity.description"
        >
          <SettingsSlider
            min={10}
            max={100}
            value={menuGamepadSensitivity}
            onChange={setMenuGamepadSensitivity}
            label="app.settings.gamepadSensitivity.sensitivity"
            suffix={`${menuGamepadSensitivity}%`}
          />
        </SettingsSection>

        <SettingsSection
          title="app.settings.gamepad.title"
          rawDescription={
            gamepadConnected
              ? t('app.settings.gamepad.description')
              : `${t('app.settings.gamepad.description')} ${t('app.settings.gamepad.notDetectedHint')}`
          }
        >
          {GAME_ACTIONS.filter((a) => a.gamepad !== undefined && (!a.experimental || menuSceneEditEnabled)).map(
            (action) => (
              <KeybindRow
                key={action.id}
                label={t(`app.settings.gamepad.labels.${action.id}`, { defaultValue: action.id })}
                fixedLabel={action.gamepad!.button}
              />
            )
          )}
        </SettingsSection>
      </div>
    )
  }
)

GamepadTab.displayName = 'GamepadTab'

export default GamepadTab
