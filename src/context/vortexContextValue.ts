import { createContext, useContext } from 'react'

export type VortexContextValue = {
  claimCanvas: (container: HTMLElement, mode: 'portal' | 'loading') => void
  releaseCanvas: (container?: HTMLElement) => void
  setErrorMode: (error: boolean) => void
}

export const VortexContext = createContext<VortexContextValue | null>(null)

export function useVortex() {
  const ctx = useContext(VortexContext)
  if (!ctx) throw new Error('useVortex must be used within VortexProvider')
  return ctx
}
