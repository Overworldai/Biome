import type { ButtonHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import RawButton, { type ButtonVariant } from './RawButton'

type ButtonProps = {
  variant: ButtonVariant
  label: TranslationKey
  className?: string
  autoShrinkLabel?: boolean
  minLabelScale?: number
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

const Button = ({ label, ...rest }: ButtonProps) => {
  const { t } = useTranslation()
  return <RawButton {...rest}>{t(label)}</RawButton>
}

export default Button
export type { ButtonProps, ButtonVariant }
