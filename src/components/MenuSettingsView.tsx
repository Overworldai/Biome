import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../i18n'
import { VIEW_DESCRIPTION, VIEW_HEADING } from '../styles'
import { useSettings } from '../hooks/settingsContextValue'
import { useStreaming } from '../context/streamingContextValue'
import { ENGINE_MODES } from '../types/settings'
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
  const [menuOfflineMode, setMenuOfflineMode] = useState(() => settings.offline_mode ?? false)
  const [menuEngineMode, setMenuEngineMode] = useState<'server' | 'standalone'>(() =>
    settings.engine_mode === ENGINE_MODES.SERVER ? 'server' : 'standalone'
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
      offline_mode: menuOfflineMode,
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
  }, [
    settings,
    saveSettings,
    volume,
    menuSceneEditEnabled,
    menuOfflineMode,
    setMouseSensitivity,
    setGamepadSensitivity
  ])

  const handleBackClick = useCallback(async () => {
    if (hasKeybindConflict) return
    if (engineRef.current && !engineRef.current.validateBeforeSave()) return
    const offlineChanged =
      settings.engine_mode === ENGINE_MODES.STANDALONE && menuOfflineMode !== (settings.offline_mode ?? false)
    if (isStreaming && (engineRef.current?.hasChangesRequiringRestart() || offlineChanged)) {
      setShowModeSwitchModal(true)
      return
    }
    await applyDraftSettings()
    onBack()
  }, [hasKeybindConflict, isStreaming, applyDraftSettings, onBack, settings, menuOfflineMode])

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
    <FocusScope onCancel={() => void handleBackClick()} autoFocus className="pointer-events-auto absolute inset-0 z-9">
      <section className="absolute top-(--edge-top) bottom-(--edge-bottom) left-(--edge-left) z-3 flex w-[90%] flex-col">
        <h2 className={VIEW_HEADING}>{t('app.settings.title')}</h2>
        <p className={VIEW_DESCRIPTION}>{t('app.settings.subtitle')}</p>
        <div
          className={`
            relative z-4 mt-[1.6cqh]
            ${wide ? 'w-[83%]' : 'w-[63%]'}
          `}
        >
          <SettingsToggle
            options={SETTINGS_TAB_OPTIONS}
            value={activeTab}
            onChange={(v) => setActiveTab(v as SettingsTab)}
          />
        </div>
        <div
          className={`
            styled-scrollbar relative z-4 mt-[1.6cqh] min-h-0 flex-1 overflow-y-auto pr-[0.8cqh] pb-[1.0cqh]
            ${wide ? 'w-[83%]' : 'w-[63%]'}
          `}
        >
          <GeneralTab
            active={activeTab === 'general'}
            menuEngineMode={menuEngineMode}
            menuSceneEditEnabled={menuSceneEditEnabled}
            setMenuSceneEditEnabled={setMenuSceneEditEnabled}
            menuOfflineMode={menuOfflineMode}
            setMenuOfflineMode={setMenuOfflineMode}
          />
          <EngineTab
            ref={engineRef}
            settings={settings}
            active={activeTab === 'engine'}
            menuEngineMode={menuEngineMode}
            setMenuEngineMode={setMenuEngineMode}
          />
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

      <div className="absolute right-(--edge-right) bottom-(--edge-bottom) z-5 flex w-btn-w flex-col gap-[1.1cqh]">
        <MenuButton
          variant="secondary"
          label="app.buttons.credits"
          className="w-full px-0"
          onClick={() => setShowCredits(true)}
        />
        <MenuButton
          variant="primary"
          label="app.buttons.back"
          className="
            w-full px-0
            disabled:cursor-not-allowed disabled:opacity-50
          "
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
          <pre
            className="
              m-0 mt-[0.8cqh] rounded-[0.4cqh] border border-border-subtle bg-white/5 p-[1.2cqh] font-mono text-[1.8cqh]
              whitespace-pre-wrap text-text-modal-muted
            "
          >
            {attributionText.trim()}
          </pre>
          <div className="mt-[1.4cqh] flex justify-end">
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
