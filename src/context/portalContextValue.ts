import { createContext, useContext } from 'react'
import { PORTAL_STATES, type PortalState } from './portalStateMachine'

export type PortalContextValue = {
  state: PortalState
  states: typeof PORTAL_STATES
  isAnimating: boolean
  isShrinking: boolean
  isExpanded: boolean
  isConnected: boolean
  showFlash: boolean
  isSettingsOpen: boolean
  toggleSettings: () => void
  runLaunchTransition: () => Promise<boolean>
  transitionTo: (newState: PortalState) => Promise<boolean>
  shutdown: () => Promise<void>
  onStateChange: (callback: (newState: PortalState, previousState: PortalState) => void) => () => void
  registerMaskRef: (element: HTMLDivElement | null) => void
  is: (state: PortalState) => boolean
}

export const PortalContext = createContext<PortalContextValue | null>(null)

export const usePortal = () => {
  const context = useContext(PortalContext)
  if (!context) {
    throw new Error('usePortal must be used within a PortalProvider')
  }
  return context
}
