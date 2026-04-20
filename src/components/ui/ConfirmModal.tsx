import { Trans, useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import Modal from './Modal'
import Button from './Button'

type ConfirmModalProps = {
  title: TranslationKey
  description: TranslationKey
  descriptionParams?: Record<string, unknown>
  descriptionComponents?: Record<string, React.ReactElement>
  onConfirm: () => void
  onCancel: () => void
  confirmLabel: TranslationKey
  cancelLabel?: TranslationKey
}

const MODAL_BUTTON = 'p-[0.5cqh_1.78cqh] text-[2.49cqh]'

const ConfirmModal = ({
  title,
  description,
  descriptionParams,
  descriptionComponents,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel = 'app.buttons.cancel'
}: ConfirmModalProps) => {
  const { t } = useTranslation()

  return (
    <Modal title={title}>
      <p className="m-0 font-serif text-[var(--color-text-modal-muted)] text-[2.4cqh] whitespace-pre-line">
        {descriptionComponents ? (
          <Trans i18nKey={description} values={descriptionParams} components={descriptionComponents} />
        ) : (
          t(description, descriptionParams)
        )}
      </p>
      <div className="flex flex-wrap justify-end mt-[1.4cqh] gap-[1.42cqh]">
        <Button variant="secondary" autoShrinkLabel label={cancelLabel} className={MODAL_BUTTON} onClick={onCancel} />
        <Button variant="primary" autoShrinkLabel label={confirmLabel} className={MODAL_BUTTON} onClick={onConfirm} />
      </div>
    </Modal>
  )
}

export default ConfirmModal
