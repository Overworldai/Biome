import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { ButtonVariant } from './Button'
import Button from './Button'

type MenuButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const MenuButton = ({ className = '', ...rest }: MenuButtonProps) => (
  <Button className={`leading-none py-[0.8cqh] px-[2.67cqh] text-body ${className}`} {...rest} />
)

export default MenuButton
