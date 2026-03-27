import type { ButtonHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import type { ButtonVariant } from './RawButton'
import RawSettingsButton from './RawSettingsButton'

type SettingsButtonProps = {
  variant: ButtonVariant
  label: TranslationKey
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

const SettingsButton = ({ label, ...rest }: SettingsButtonProps) => {
  const { t } = useTranslation()
  return <RawSettingsButton {...rest}>{t(label)}</RawSettingsButton>
}

export default SettingsButton
