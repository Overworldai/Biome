import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../../bridge'
import type { RecordingEntry } from '../../types/ipc'
import { SETTINGS_MUTED_TEXT, SETTINGS_MUTED_TEXT_WITHOUT_FONT_SIZE } from '../../styles'
import Modal from '../ui/Modal'
import ConfirmModal from '../ui/ConfirmModal'
import Button from '../ui/Button'

type RecordingsModalProps = {
  configuredDir: string
  onClose: () => void
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const formatDate = (mtimeMs: number, locale: string): string => {
  const d = new Date(mtimeMs)
  const resolved = locale === 'goose' ? undefined : locale
  return new Intl.DateTimeFormat(resolved, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

const RecordingsModal = ({ configuredDir, onClose }: RecordingsModalProps) => {
  const { t, i18n } = useTranslation()
  const [entries, setEntries] = useState<RecordingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<RecordingEntry | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await invoke('list-recordings', configuredDir)
      setEntries(list)
    } finally {
      setLoading(false)
    }
  }, [configuredDir])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleOpenFolder = useCallback(() => {
    void invoke('open-recordings-folder', configuredDir)
  }, [configuredDir])

  const handleOpenExternally = useCallback((entry: RecordingEntry) => {
    void invoke('open-recording-externally', entry.path)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return
    await invoke('delete-recording', confirmDelete.path)
    setConfirmDelete(null)
    await refresh()
  }, [confirmDelete, refresh])

  const rows = useMemo(
    () =>
      entries.map((entry) => (
        <RecordingRow
          key={entry.path}
          entry={entry}
          locale={i18n.language}
          onOpen={() => handleOpenExternally(entry)}
          onDelete={() => setConfirmDelete(entry)}
        />
      )),
    [entries, i18n.language, handleOpenExternally]
  )

  return (
    <>
      <Modal title="app.dialogs.recordings.title" onCancel={onClose} onBackdropClick={onClose}>
        <div className="mt-[1.2cqh] flex items-center justify-between gap-[1cqh]">
          <p
            className={`
              m-0
              ${SETTINGS_MUTED_TEXT}
              text-[2cqh]
            `}
          >
            {configuredDir}
          </p>
          <div className="flex gap-[0.8cqh]">
            <Button
              variant="secondary"
              autoShrinkLabel
              label="app.dialogs.recordings.refresh"
              className="px-[1.4cqh] py-[0.2cqh] text-[2cqh]"
              onClick={() => void refresh()}
            />
            <Button
              variant="secondary"
              autoShrinkLabel
              label="app.dialogs.recordings.openFolder"
              className="px-[1.4cqh] py-[0.2cqh] text-[2cqh]"
              onClick={handleOpenFolder}
            />
          </div>
        </div>

        <div className="styled-scrollbar mt-[1.4cqh] max-h-[52cqh] min-h-[20cqh] overflow-y-auto pr-[0.4cqh]">
          {loading ? (
            <p
              className={`
                m-[4cqh_0] text-center
                ${SETTINGS_MUTED_TEXT}
              `}
            >
              …
            </p>
          ) : entries.length === 0 ? (
            <p
              className={`
                m-[4cqh_0] text-center
                ${SETTINGS_MUTED_TEXT}
              `}
            >
              {t('app.dialogs.recordings.empty')}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[0.8cqh] p-0">{rows}</ul>
          )}
        </div>

        <div className="mt-[1.4cqh] flex justify-end">
          <Button
            variant="primary"
            autoShrinkLabel
            label="app.buttons.close"
            className="p-[0.5cqh_1.78cqh] text-[2.49cqh]"
            onClick={onClose}
          />
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmModal
          title="app.dialogs.recordings.confirmDeleteTitle"
          description="app.dialogs.recordings.confirmDeleteDescription"
          descriptionParams={{ filename: confirmDelete.filename }}
          descriptionComponents={{ bold: <span className="text-white" /> }}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
          confirmLabel="app.buttons.delete"
        />
      )}
    </>
  )
}

type RecordingRowProps = {
  entry: RecordingEntry
  locale: string
  onOpen: () => void
  onDelete: () => void
}

/** Strip any `org/` prefix from a model URI for compact display. */
const shortModelName = (model: string | null | undefined): string | null => {
  if (!model) return null
  const slash = model.lastIndexOf('/')
  return slash >= 0 ? model.slice(slash + 1) : model
}

const RecordingRow = ({ entry, locale, onOpen, onDelete }: RecordingRowProps) => {
  const src = `biome-recording://serve/${encodeURIComponent(entry.filename)}`
  const model = shortModelName(entry.properties?.model)
  const date = formatDate(entry.mtime_ms, locale)
  const subtitle = model ? `${model} · ${date}` : date

  return (
    <li className="flex items-stretch gap-[1.2cqh] border border-border-medium bg-white/5 p-[0.8cqh]">
      <video
        src={src}
        className="h-[11cqh] w-[19.5cqh] shrink-0 self-center bg-black object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-[0.4cqh]">
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-baseline gap-[0.8cqh]">
            <span className="truncate font-serif text-[2.4cqh] text-text-primary">{entry.filename}</span>
            <span
              className={`
                shrink-0
                ${SETTINGS_MUTED_TEXT}
              `}
            >
              {formatBytes(entry.size_bytes)}
            </span>
          </div>
          <p
            className={`
              m-0 truncate
              ${SETTINGS_MUTED_TEXT_WITHOUT_FONT_SIZE}
            `}
          >
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 justify-end gap-[0.8cqh]">
          <Button
            variant="danger"
            autoShrinkLabel
            label="app.buttons.delete"
            className="px-[1.2cqh] py-[0.2cqh] text-[1.9cqh]"
            onClick={onDelete}
          />
          <Button
            variant="secondary"
            autoShrinkLabel
            label="app.dialogs.recordings.openExternally"
            className="px-[1.2cqh] py-[0.2cqh] text-[1.9cqh]"
            onClick={onOpen}
          />
        </div>
      </div>
    </li>
  )
}

export default RecordingsModal
