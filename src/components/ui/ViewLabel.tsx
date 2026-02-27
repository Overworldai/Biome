import type { ReactNode } from 'react'

const ViewLabel = ({ children }: { children: ReactNode }) => (
  <div className="absolute left-[var(--edge-left)] bottom-[var(--edge-bottom)] font-serif text-[clamp(56px,4.8cqw,82px)] leading-[0.8] text-left text-text-primary font-normal pointer-events-none">
    {children}
  </div>
)

export default ViewLabel
