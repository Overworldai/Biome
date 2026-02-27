import type { ReactNode } from 'react'

type HudTabButtonProps = {
  active?: boolean
  title?: string
  onClick?: () => void
  children: ReactNode
}

const HudTabButton = ({ active, title, onClick, children }: HudTabButtonProps) => (
  <button
    className={`w-[3cqw] h-[3cqw] min-w-7 min-h-7 p-0 flex items-center justify-center text-hud/40 bg-hud/3 border border-hud/15 rounded-panel cursor-pointer transition-all duration-200 ease-in-out [&>svg]:w-[60%] [&>svg]:h-[60%] hover:text-hud/80 hover:bg-hud/8 hover:border-hud/30 ${active ? 'active text-hud bg-hud/12 !border-hud/50' : ''}`}
    onClick={onClick}
    title={title}
  >
    {children}
  </button>
)

export default HudTabButton
