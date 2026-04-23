import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { ButtonVariant } from './RawButton'
import RawButton from './RawButton'

/** Menu-button font-size scale. `md` matches the body text token; `sm` and
 *  `lg` are used at the edges — compact inline actions and top-level entrances
 *  respectively. The mapped class is the only font-size applied to the button,
 *  so callers never have to `!`-override a default. */
export type MenuButtonSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<MenuButtonSize, string> = {
  sm: 'text-[2.8cqh]',
  md: 'text-body',
  lg: 'text-[3.91cqh]'
}

type RawMenuButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
  size?: MenuButtonSize
  /** Applies `w-full px-0` — the convention for stacked button columns where
   *  the parent already controls width (`w-btn-w`) and horizontal padding would
   *  squeeze the label. */
  fullWidth?: boolean
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const RawMenuButton = ({ className = '', size = 'md', fullWidth = false, ...rest }: RawMenuButtonProps) => (
  <RawButton
    autoShrinkLabel
    className={`
      min-h-[5.2cqh] py-[0.8cqh] leading-[1.05]
      ${fullWidth ? 'w-full px-0' : 'px-[2.67cqh]'}
      ${SIZE_CLASS[size]}
      ${className}
    `}
    {...rest}
  />
)

export default RawMenuButton
