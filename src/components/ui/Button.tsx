import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

type ButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-border-light outline-border-light bg-surface-btn-primary text-text-inverse',
  secondary: 'border-border-light outline-border-light bg-surface-btn-secondary text-text-secondary',
  danger:
    'border-[rgba(193,32,11,0.95)] outline-[rgba(193,32,11,0.95)] bg-[rgba(156,23,8,0.9)] text-[rgba(255,240,240,0.98)]',
  ghost:
    'border-[rgba(245,251,255,0.8)] outline-[rgba(245,251,255,0.8)] bg-[rgba(8,12,20,0.28)] text-text-secondary hover:bg-[rgba(245,251,255,0.9)] hover:text-[rgba(15,20,32,0.95)] hover:-translate-y-px'
}

const Button = ({ variant, children, className = '', ...rest }: ButtonProps) => (
  <button
    type="button"
    className={`font-serif rounded-none cursor-pointer border outline-0 hover:outline-2 transition-[color,background-color,border-color,outline-color,transform,box-shadow] duration-150 ${variantClasses[variant]} ${className}`}
    {...rest}
  >
    {children}
  </button>
)

export default Button
export type { ButtonProps, ButtonVariant }
