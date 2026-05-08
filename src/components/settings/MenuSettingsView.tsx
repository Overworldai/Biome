import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { VIEW_DESCRIPTION, VIEW_HEADING } from '../../styles'
import { useSettings } from '../../hooks/settings/settingsContextValue'
import { useConnection } from '../../context/streaming/connection'
import { ENGINE_MODES, type Settings } from '../../types/settings'
import { diffRequiresRestartConfirmation } from '../../utils/settingsClassifier'
import { useVolumeControls } from '../../hooks/audio/useVolumeControls'
import MenuButton from '../ui/MenuButton'
import SettingsToggle from '../ui/SettingsToggle'
import { useGamepadConnected } from '../../hooks/input/useGameInput'
import { FocusScope } from '../../context/focus/FocusScopeContext'
import Modal from '../ui/Modal'
import ConfirmModal from '../ui/ConfirmModal'
import Button from '../ui/Button'
import attributionText from '../../../assets/audio/ATTRIBUTION.md?raw'
import GeneralTab from './GeneralTab'
import EngineTab, { type EngineTabHandle } from './EngineTab'
import KeyboardTab, { type KeyboardTabHandle } from './KeyboardTab'
import GamepadTab, { type GamepadTabHandle } from './GamepadTab'
import DebugTab, { type DebugTabHandle } from './DebugTab'

type MenuSettingsViewProps = {
  onBack: () => void
}

type SettingsTab = 'general' | 'engine' | 'keyboard' | 'gamepad' | 'debug'

const SETTINGS_TAB_OPTIONS: { value: SettingsTab; label: TranslationKey }[] = [
  { value: 'general', label: 'app.settings.tabs.general' },
  { value: 'engine', label: 'app.settings.tabs.engine' },
  { value: 'keyboard', label: 'app.settings.tabs.keyboard' },
  { value: 'gamepad', label: 'app.settings.tabs.gamepad' },
  { value: 'debug', label: 'app.settings.tabs.debug' }
]

const MenuSettingsView = ({ onBack }: MenuSettingsViewProps) => {
  const { t } = useTranslation()
  const { settings, saveSettings } = useSettings()
  const gamepadConnected = useGamepadConnected()
  const { isStreaming } = useConnection()
  const volume = useVolumeControls()

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [menuSceneAuthoringEnabled, setMenuSceneAuthoringEnabled] = useState(
    () => settings.scene_authoring_enabled ?? false
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

  const buildPendingSettings = useCallback((): Settings => {
    const engineDraft = engineRef.current?.collectDraft() ?? {}
    const keyboardDraft = keyboardRef.current?.collectDraft() ?? {}
    const gamepadDraft = gamepadRef.current?.collectDraft() ?? {}
    const debugDraft = debugRef.current?.collectDraft() ?? {}

    return {
      ...settings,
      ...engineDraft,
      ...keyboardDraft,
      ...gamepadDraft,
      ...debugDraft,
      audio: volume.getAudioSettings(),
      offline_mode: menuOfflineMode,
      scene_authoring_enabled: menuSceneAuthoringEnabled
    }
  }, [settings, volume, menuSceneAuthoringEnabled, menuOfflineMode])

  const applyDraftSettings = useCallback(async () => {
    await saveSettings(buildPendingSettings())
  }, [saveSettings, buildPendingSettings])

  const handleBackClick = useCallback(async () => {
    if (hasKeybindConflict) return
    if (engineRef.current && !engineRef.current.validateBeforeSave()) return
    if (isStreaming && diffRequiresRestartConfirmation(settings, buildPendingSettings())) {
      setShowModeSwitchModal(true)
      return
    }
    await applyDraftSettings()
    onBack()
  }, [hasKeybindConflict, isStreaming, applyDraftSettings, onBack, settings, buildPendingSettings])

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
      <section className="absolute top-(--edge-top) right-(--edge-right) bottom-[11cqh] left-(--edge-left) z-3 flex flex-col">
        <h2 className={VIEW_HEADING}>{t('app.settings.title')}</h2>
        <p className={VIEW_DESCRIPTION}>{t('app.settings.subtitle')}</p>
        <div className="relative z-4 mt-[1.6cqh] flex min-h-0 flex-1 gap-[1.6cqh]">
          <div className="w-[22cqh] shrink-0">
            <SettingsToggle
              orientation="vertical"
              options={SETTINGS_TAB_OPTIONS}
              value={activeTab}
              onChange={(v) => setActiveTab(v as SettingsTab)}
            />
          </div>
          <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto px-[2cqh] pb-[1.0cqh]">
            <GeneralTab
              active={activeTab === 'general'}
              menuEngineMode={menuEngineMode}
              menuSceneAuthoringEnabled={menuSceneAuthoringEnabled}
              setMenuSceneAuthoringEnabled={setMenuSceneAuthoringEnabled}
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
              menuSceneAuthoringEnabled={menuSceneAuthoringEnabled}
              onConflictChange={handleConflictChange}
            />
            <GamepadTab
              ref={gamepadRef}
              settings={settings}
              active={activeTab === 'gamepad'}
              gamepadConnected={gamepadConnected}
              menuSceneAuthoringEnabled={menuSceneAuthoringEnabled}
            />
            <DebugTab ref={debugRef} settings={settings} active={activeTab === 'debug'} />
          </div>
        </div>
      </section>

      <div className="absolute right-(--edge-right) bottom-(--edge-bottom) z-5 flex gap-[1.1cqh]">
        <MenuButton variant="secondary" label="app.buttons.credits" onClick={() => setShowCredits(true)} />
        <MenuButton
          variant="primary"
          label="app.buttons.back"
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
