import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { ButtonVariant } from './Button'
import Button from './Button'

type SettingsButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const SettingsButton = ({ className = '', ...rest }: SettingsButtonProps) => (
  <Button className={`leading-[1.2] p-[0.55cqh_0.8cqw] text-[clamp(18px,1.5cqw,24px)] ${className}`} {...rest} />
)

export default SettingsButton
