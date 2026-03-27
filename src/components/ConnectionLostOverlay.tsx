import { invoke } from '../bridge'
import { useStreaming } from '../context/StreamingContext'
import Button from './ui/Button'
import { useTranslation } from 'react-i18next'

const ConnectionLostOverlay = () => {
  const { t } = useTranslation()
  const { connectionLost, reconnectAfterConnectionLost } = useStreaming()

  const handleReconnect = () => {
    void reconnectAfterConnectionLost()
  }

  const handleQuit = () => {
    void invoke('quit-app')
  }

  return (
    <div
      className={`connection-lost-overlay absolute inset-0 z-200 flex items-center justify-center bg-darkest/90 backdrop-blur-[0.56cqh] ${connectionLost ? 'active pointer-events-auto visible opacity-100' : 'pointer-events-none invisible opacity-0'}`}
    >
      <div className="border border-[var(--color-border-medium)] bg-[var(--color-surface-modal)] text-[var(--color-text-primary)] w-[58.33cqh] p-[3cqh_2.84cqh] flex flex-col items-center gap-[3cqh] animate-[connectionLostFadeIn_0.4s_ease-out]">
        <div className="w-[8.5cqh] h-[8.5cqh] text-error-muted animate-[connectionLostPulse_2s_ease-in-out_infinite]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>
        <div className="flex flex-col items-center">
          <h3 className="m-0 font-serif font-medium text-[3.91cqh]">{t('app.dialogs.connectionLost.title')}</h3>
          <p className="m-0 font-serif text-[var(--color-text-modal-muted)] text-[2.4cqh] text-center">
            {t('app.dialogs.connectionLost.description')}
          </p>
        </div>
        <div className="flex justify-end gap-[1.5cqh] w-full">
          <Button
            variant="danger"
            autoShrinkLabel
            label="app.buttons.quit"
            className="p-[0.5cqh_1.78cqh] text-[2.49cqh]"
            onClick={handleQuit}
          />
          <Button
            variant="primary"
            autoShrinkLabel
            label="app.buttons.reconnect"
            className="p-[0.5cqh_1.78cqh] text-[2.49cqh]"
            onClick={handleReconnect}
          />
        </div>
      </div>
    </div>
  )
}

export default ConnectionLostOverlay
