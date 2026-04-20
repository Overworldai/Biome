import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../i18n'
import { VIEW_DESCRIPTION, VIEW_HEADING } from '../styles'
import { useSettings } from '../hooks/useSettings'
import { useStreaming } from '../context/StreamingContext'
import { useVolumeControls } from '../hooks/useVolumeControls'
import MenuButton from './ui/MenuButton'
import SettingsToggle from './ui/SettingsToggle'
import { useGamepadConnected } from '../hooks/useGameInput'
import { FocusScope } from '../context/FocusScopeContext'
import Modal from './ui/Modal'
import ConfirmModal from './ui/ConfirmModal'
import Button from './ui/Button'
import attributionText from '../../assets/audio/ATTRIBUTION.md?raw'
import GeneralTab from './settings/GeneralTab'
import EngineTab, { type EngineTabHandle } from './settings/EngineTab'
import KeyboardTab, { type KeyboardTabHandle } from './settings/KeyboardTab'
import GamepadTab, { type GamepadTabHandle } from './settings/GamepadTab'
import DebugTab, { type DebugTabHandle } from './settings/DebugTab'

type MenuSettingsViewProps = {
  onBack: () => void
  wide?: boolean
}

type SettingsTab = 'general' | 'engine' | 'keyboard' | 'gamepad' | 'debug'

const SETTINGS_TAB_OPTIONS: { value: SettingsTab; label: TranslationKey }[] = [
  { value: 'general', label: 'app.settings.tabs.general' },
  { value: 'engine', label: 'app.settings.tabs.engine' },
  { value: 'keyboard', label: 'app.settings.tabs.keyboard' },
  { value: 'gamepad', label: 'app.settings.tabs.gamepad' },
  { value: 'debug', label: 'app.settings.tabs.debug' }
]

const MenuSettingsView = ({ onBack, wide }: MenuSettingsViewProps) => {
  const { t } = useTranslation()
  const { settings, saveSettings } = useSettings()
  const gamepadConnected = useGamepadConnected()
  const { isStreaming, mouseSensitivity, setMouseSensitivity, gamepadSensitivity, setGamepadSensitivity } =
    useStreaming()
  const volume = useVolumeControls()

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [menuSceneEditEnabled, setMenuSceneEditEnabled] = useState(
    () => settings.experimental?.scene_edit_enabled ?? false
  )
  const [hasKeybindConflict, setHasKeybindConflict] = useState(false)
  const [showModeSwitchModal, setShowModeSwitchModal] = useState(false)
  const [showCredits, setShowCredits] = useState(false)

  const engineRef = useRef<EngineTabHandle>(null)
  const keyboardRef = useRef<KeyboardTabHandle>(null)
  const gamepadRef = useRef<GamepadTabHandle>(null)
  const debugRef = useRef<DebugTabHandle>(null)

  const handleConflictChange = useCallback((hasConflict: boolean) => {
    setHasKeybindConflict(hasConflict)
  }, [])

  const applyDraftSettings = useCallback(async () => {
    const engineDraft = engineRef.current?.collectDraft() ?? {}
    const keyboardDraft = keyboardRef.current?.collectDraft() ?? {}
    const gamepadDraft = gamepadRef.current?.collectDraft() ?? {}
    const debugDraft = debugRef.current?.collectDraft() ?? {}

    await saveSettings({
      ...settings,
      ...engineDraft,
      ...keyboardDraft,
      ...gamepadDraft,
      ...debugDraft,
      audio: volume.getAudioSettings(),
      experimental: {
        scene_edit_enabled: menuSceneEditEnabled
      }
    })
    if (keyboardDraft.mouse_sensitivity !== undefined) {
      setMouseSensitivity(keyboardDraft.mouse_sensitivity)
    }
    if (gamepadDraft.gamepad_sensitivity !== undefined) {
      setGamepadSensitivity(gamepadDraft.gamepad_sensitivity)
    }
  }, [settings, saveSettings, volume, menuSceneEditEnabled, setMouseSensitivity, setGamepadSensitivity])

  const handleBackClick = useCallback(async () => {
    if (hasKeybindConflict) return
    if (engineRef.current && !engineRef.current.validateBeforeSave()) return
    if (isStreaming && engineRef.current?.hasChangesRequiringRestart()) {
      setShowModeSwitchModal(true)
      return
    }
    await applyDraftSettings()
    onBack()
  }, [hasKeybindConflict, isStreaming, applyDraftSettings, onBack])

  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void handleBackClick()
      }
    }
    window.addEventListener('keyup', handleKeyUp)
    return () => window.removeEventListener('keyup', handleKeyUp)
  }, [handleBackClick])

  const handleConfirmEngineModeSwitch = async () => {
    if (hasKeybindConflict) {
      setShowModeSwitchModal(false)
      return
    }
    if (engineRef.current && !engineRef.current.validateBeforeSave()) {
      setShowModeSwitchModal(false)
      return
    }
    setShowModeSwitchModal(false)
    await applyDraftSettings()
    onBack()
  }

  return (
    <FocusScope
      onCancel={() => void handleBackClick()}
      autoFocus
      className="absolute inset-0 z-[9] pointer-events-auto"
    >
      <section className="absolute top-[var(--edge-top-xl)] bottom-[var(--edge-bottom)] left-[var(--edge-left)] w-[90%] z-[3] flex flex-col">
        <h2 className={VIEW_HEADING}>{t('app.settings.title')}</h2>
        <p className={VIEW_DESCRIPTION}>{t('app.settings.subtitle')}</p>
        <div className={`mt-[1.6cqh] relative z-[4] ${wide ? 'w-[83%]' : 'w-[63%]'}`}>
          <SettingsToggle
            options={SETTINGS_TAB_OPTIONS}
            value={activeTab}
            onChange={(v) => setActiveTab(v as SettingsTab)}
          />
        </div>
        <div
          className={`styled-scrollbar overflow-y-auto pr-[0.8cqh] pb-[1.0cqh] flex-1 min-h-0 mt-[1.6cqh] relative z-[4] ${wide ? 'w-[83%]' : 'w-[63%]'}`}
        >
          <GeneralTab
            active={activeTab === 'general'}
            menuSceneEditEnabled={menuSceneEditEnabled}
            setMenuSceneEditEnabled={setMenuSceneEditEnabled}
          />
          <EngineTab ref={engineRef} settings={settings} active={activeTab === 'engine'} />
          <KeyboardTab
            ref={keyboardRef}
            settings={settings}
            active={activeTab === 'keyboard'}
            menuSceneEditEnabled={menuSceneEditEnabled}
            initialMouseSensitivityFallback={mouseSensitivity}
            onConflictChange={handleConflictChange}
          />
          <GamepadTab
            ref={gamepadRef}
            settings={settings}
            active={activeTab === 'gamepad'}
            gamepadConnected={gamepadConnected}
            menuSceneEditEnabled={menuSceneEditEnabled}
            initialSensitivityFallback={gamepadSensitivity}
          />
          <DebugTab ref={debugRef} settings={settings} active={activeTab === 'debug'} />
        </div>
      </section>

      <div className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] z-[5] w-btn-w flex flex-col gap-[1.1cqh]">
        <MenuButton
          variant="secondary"
          label="app.buttons.credits"
          className="w-full px-0"
          onClick={() => setShowCredits(true)}
        />
        <MenuButton
          variant="primary"
          label="app.buttons.back"
          className="w-full px-0 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={hasKeybindConflict}
          onClick={() => {
            void handleBackClick()
          }}
        />
      </div>

      {showModeSwitchModal && (
        <ConfirmModal
          title="app.dialogs.applyEngineChanges.title"
          description="app.dialogs.applyEngineChanges.description"
          onCancel={() => setShowModeSwitchModal(false)}
          onConfirm={() => {
            void handleConfirmEngineModeSwitch()
          }}
          confirmLabel="app.buttons.switchMode"
          cancelLabel="app.buttons.keepCurrent"
        />
      )}

      {showCredits && (
        <Modal title="app.settings.credits.title" onBackdropClick={() => setShowCredits(false)}>
          <pre className="m-0 mt-[0.8cqh] font-mono text-[1.8cqh] text-text-modal-muted whitespace-pre-wrap border border-border-subtle bg-white/5 p-[1.2cqh] rounded-[0.4cqh]">
            {attributionText.trim()}
          </pre>
          <div className="flex justify-end mt-[1.4cqh]">
            <Button
              variant="primary"
              autoShrinkLabel
              label="app.buttons.close"
              className="p-[0.5cqh_1.78cqh] text-[2.49cqh]"
              onClick={() => setShowCredits(false)}
            />
          </div>
        </Modal>
      )}
    </FocusScope>
  )
}

export default MenuSettingsView
