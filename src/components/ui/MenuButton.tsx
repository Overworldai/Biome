import type { ButtonHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import type { ButtonVariant } from './RawButton'
import type { MenuButtonSize } from './RawMenuButton'
import RawMenuButton from './RawMenuButton'

type MenuButtonProps = {
  variant: ButtonVariant
  label: TranslationKey
  className?: string
  size?: MenuButtonSize
  fullWidth?: boolean
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

const MenuButton = ({ label, ...rest }: MenuButtonProps) => {
  const { t } = useTranslation()
  return <RawMenuButton {...rest}>{t(label)}</RawMenuButton>
}

export default MenuButton
