import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { ButtonVariant } from './RawButton'
import RawButton from './RawButton'

type RawSettingsButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const RawSettingsButton = ({ className = '', ...rest }: RawSettingsButtonProps) => (
  <RawButton
    autoShrinkLabel
    className={`
      min-h-[4.6cqh] p-[0.55cqh_1.42cqh] text-[2.67cqh] leading-[1.15]
      ${className}
    `}
    {...rest}
  />
)

export default RawSettingsButton
