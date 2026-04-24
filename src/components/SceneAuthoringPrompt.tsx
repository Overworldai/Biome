import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT } from '../styles'

interface SceneAuthoringPromptProps {
  isGenerating: boolean
  generateError: string | null
  onGenerate: (prompt: string) => void
  showDivider?: boolean
}

const SceneAuthoringPrompt = ({
  isGenerating,
  generateError,
  onGenerate,
  showDivider = true
}: SceneAuthoringPromptProps) => {
  const { t } = useTranslation()
  const [promptText, setPromptText] = useState('')

  return (
    <>
      {showDivider && (
        <div className="mt-[0.8cqh] flex items-center gap-[1.5cqh]">
          <div className="h-px flex-1 bg-border-subtle" />
          <span className="font-serif text-caption text-text-muted">{t('app.pause.generateScene.divider')}</span>
          <div className="h-px flex-1 bg-border-subtle" />
        </div>
      )}
      <div
        className={`
          relative
          ${showDivider ? 'mt-[1.5cqh]' : ''}
        `}
      >
        {generateError && <p className="m-0 mb-[0.8cqh] font-serif text-caption text-red-400">{generateError}</p>}
        <textarea
          rows={3}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          disabled={isGenerating}
          placeholder={t('app.pause.generateScene.placeholder')}
          className={`
            ${SETTINGS_CONTROL_BASE}
            ${SETTINGS_CONTROL_TEXT}
            w-full resize-none outline-none
            focus:ring-1 focus:ring-border-medium
            disabled:opacity-50
          `}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              const trimmed = promptText.trim()
              if (trimmed && !isGenerating) {
                onGenerate(trimmed)
              }
            }
          }}
          onKeyUp={(e) => e.stopPropagation()}
        />
        {isGenerating && (
          <div
            className="
              absolute top-1/2 right-[1.2cqh] h-[2cqh] w-[2cqh] -translate-y-1/2 animate-spin rounded-full
              border-[0.3cqh] border-text-muted border-t-text-primary
            "
          />
        )}
      </div>
    </>
  )
}

export default SceneAuthoringPrompt
