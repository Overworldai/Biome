import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { ButtonVariant } from './RawButton'
import RawButton from './RawButton'

type RawMenuButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const RawMenuButton = ({ className = '', ...rest }: RawMenuButtonProps) => (
  <RawButton
    autoShrinkLabel
    className={`
      min-h-[5.2cqh] px-[2.67cqh] py-[0.8cqh] text-body leading-[1.05]
      ${className}
    `}
    {...rest}
  />
)

export default RawMenuButton
