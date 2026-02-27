import type { ReactNode } from 'react'

const ViewLabel = ({ children }: { children: ReactNode }) => (
  <div className="absolute left-[4%] bottom-[var(--pause-bottom-baseline,4.1%)] font-serif text-[clamp(56px,4.8cqw,82px)] leading-[0.8] text-left text-text-primary font-normal translate-y-[0.35cqh] pointer-events-none">
    {children}
  </div>
)

export default ViewLabel
