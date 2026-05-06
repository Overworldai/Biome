export const PORTAL_STATES = {
  MAIN_MENU: 'main_menu',
  LOADING: 'loading',
  STREAMING: 'streaming'
} as const

export type PortalState = (typeof PORTAL_STATES)[keyof typeof PORTAL_STATES]

// Explicit transition graph for portal lifecycle.
export const PORTAL_TRANSITIONS: Record<PortalState, Set<PortalState>> = {
  [PORTAL_STATES.MAIN_MENU]: new Set([PORTAL_STATES.MAIN_MENU, PORTAL_STATES.LOADING]),
  [PORTAL_STATES.LOADING]: new Set([PORTAL_STATES.LOADING, PORTAL_STATES.MAIN_MENU, PORTAL_STATES.STREAMING]),
  [PORTAL_STATES.STREAMING]: new Set([PORTAL_STATES.STREAMING, PORTAL_STATES.LOADING, PORTAL_STATES.MAIN_MENU])
}

export const canTransitionPortalState = (fromState: PortalState, toState: PortalState): boolean => {
  return PORTAL_TRANSITIONS[fromState]?.has(toState) ?? false
}
