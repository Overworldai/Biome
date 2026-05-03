import type { ReactNode } from 'react'

const ViewLabel = ({ children }: { children: ReactNode }) => (
  <div
    className="
      pointer-events-none absolute bottom-(--edge-bottom) left-(--edge-left) text-left font-serif text-[8.53cqh]
      leading-[0.8] font-normal text-text-primary
    "
  >
    {children}
  </div>
)

export default ViewLabel
