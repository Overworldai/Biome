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
    <Modal title={title} onCancel={onCancel}>
      <p className="m-0 font-serif text-[2.4cqh] whitespace-pre-line text-text-modal-muted">
        {descriptionComponents ? (
          // `as never` avoids TS2590: the TranslationKey union is now large
          // enough that Trans's generic inference on `i18nKey` blows past
          // TS's type-complexity limit. `description` is already validated
          // as a TranslationKey at the component boundary.
          <Trans i18nKey={description as never} values={descriptionParams} components={descriptionComponents} />
        ) : (
          // @ts-expect-error TS complexity bailout — t()'s options parameter
          // is an intersection of every possible param shape across the full
          // TranslationKey union, which hits TS's inference limit.
          // `description` is already validated as a TranslationKey at the
          // component boundary.
          t(description, descriptionParams)
        )}
      </p>
      <div className="mt-[1.4cqh] flex flex-wrap justify-end gap-[1.42cqh]">
        <Button
          variant="secondary"
          autoShrinkLabel
          label={cancelLabel}
          className={MODAL_BUTTON}
          onClick={onCancel}
          data-default-focus
        />
        <Button variant="primary" autoShrinkLabel label={confirmLabel} className={MODAL_BUTTON} onClick={onConfirm} />
      </div>
    </Modal>
  )
}

export default ConfirmModal
