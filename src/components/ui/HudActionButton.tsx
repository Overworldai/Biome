import type { ReactNode, Ref } from 'react'

type HudActionButtonProps = {
  icon: ReactNode
  label: string
  onClick?: () => void
  title?: string
  danger?: boolean
  disabled?: boolean
  iconRef?: Ref<HTMLSpanElement>
  iconClassName?: string
}

const HudActionButton = ({
  icon,
  label,
  onClick,
  title,
  danger,
  disabled,
  iconRef,
  iconClassName = ''
}: HudActionButtonProps) => {
  const hoverIcon = danger
    ? 'group-hover/action:text-[rgba(255,120,120,1)]'
    : 'group-hover/action:text-hud'
  const hoverLabel = danger
    ? 'group-hover/action:text-[rgba(255,120,120,1)]'
    : 'group-hover/action:text-hud'

  return (
    <div
      className={`group/action flex items-center gap-[0.3cqw] cursor-pointer ${disabled ? 'cursor-not-allowed opacity-30' : ''}`}
      onClick={disabled ? undefined : onClick}
      title={title}
    >
      <span
        ref={iconRef}
        className={`shrink-0 w-[2cqw] h-[2cqw] min-w-[18px] min-h-[18px] flex items-center justify-center p-0 bg-transparent border-none text-hud/60 cursor-pointer transition-all duration-200 ease-in-out [&>svg]:w-full [&>svg]:h-full ${hoverIcon} active:scale-95 ${disabled ? 'opacity-30 cursor-not-allowed group-hover/action:text-hud/50' : ''} ${iconClassName}`}
      >
        {icon}
      </span>
      <span
        className={`font-mono text-[1.4cqw] min-w-max text-hud/50 tracking-wide uppercase transition-colors duration-200 ease-in-out ${hoverLabel} ${disabled ? 'group-hover/action:text-hud/50' : ''}`}
      >
        {label}
      </span>
    </div>
  )
}

export default HudActionButton
