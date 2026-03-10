import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useUISound } from '../../hooks/useUISound'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

type ButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-border-light outline-border-light bg-surface-btn-primary text-text-inverse',
  secondary:
    'border-border-light outline-border-light bg-surface-btn-secondary text-text-primary hover:bg-surface-btn-hover hover:text-text-inverse hover:-translate-y-px',
  danger: 'border-danger outline-danger bg-danger text-text-primary'
}

const Button = ({ variant, children, className = '', ...rest }: ButtonProps) => {
  const { playHover, playClick } = useUISound()

  return (
    <button
      type="button"
      className={`font-serif rounded-none cursor-pointer border outline-0 hover:outline-2 transition-[color,background-color,border-color,outline-color,transform,box-shadow] duration-150 ${variantClasses[variant]} ${className}`}
      onMouseEnter={playHover}
      onMouseDown={playClick}
      {...rest}
    >
      {children}
    </button>
  )
}

export default Button
export type { ButtonProps, ButtonVariant }
