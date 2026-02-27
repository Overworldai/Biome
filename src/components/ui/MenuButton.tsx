import type { ButtonHTMLAttributes, ReactNode } from 'react'

type MenuButtonProps = {
  variant: 'primary' | 'secondary' | 'danger' | 'ghost'
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const variantClasses: Record<MenuButtonProps['variant'], string> = {
  primary: 'border-border-light outline-border-light bg-surface-btn-primary text-text-inverse',
  secondary: 'border-border-light outline-border-light bg-surface-btn-secondary text-text-secondary',
  danger:
    'border-[rgba(193,32,11,0.95)] outline-[rgba(193,32,11,0.95)] bg-[rgba(156,23,8,0.9)] text-[rgba(255,240,240,0.98)]',
  ghost:
    'border-[rgba(245,251,255,0.8)] outline-[rgba(245,251,255,0.8)] bg-[rgba(8,12,20,0.28)] text-text-secondary hover:bg-[rgba(245,251,255,0.9)] hover:text-[rgba(15,20,32,0.95)] hover:-translate-y-px'
}

const MenuButton = ({ variant, children, className = '', ...rest }: MenuButtonProps) => (
  <button
    type="button"
    className={`font-serif text-body leading-none py-[0.8cqh] rounded-none cursor-pointer border outline-0 hover:outline-2 transition-all duration-150 ${variantClasses[variant]} ${className}`}
    {...rest}
  >
    {children}
  </button>
)

export default MenuButton
