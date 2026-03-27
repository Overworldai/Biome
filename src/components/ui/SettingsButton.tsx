import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { ButtonVariant } from './Button'
import Button from './Button'

type SettingsButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const SettingsButton = ({ className = '', ...rest }: SettingsButtonProps) => (
  <Button
    autoShrinkLabel
    className={`min-h-[4.6cqh] leading-[1.15] p-[0.55cqh_1.42cqh] text-[2.67cqh] ${className}`}
    {...rest}
  />
)

export default SettingsButton
