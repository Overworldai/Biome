export const PORTAL_STATES = {
  COLD: 'cold',
  WARM: 'warm',
  HOT: 'hot',
  STREAMING: 'streaming'
} as const

export type PortalState = (typeof PORTAL_STATES)[keyof typeof PORTAL_STATES]

// Explicit transition graph for portal lifecycle.
export const PORTAL_TRANSITIONS: Record<PortalState, Set<PortalState>> = {
  [PORTAL_STATES.COLD]: new Set([PORTAL_STATES.COLD, PORTAL_STATES.WARM]),
  [PORTAL_STATES.WARM]: new Set([PORTAL_STATES.COLD, PORTAL_STATES.WARM, PORTAL_STATES.HOT]),
  [PORTAL_STATES.HOT]: new Set([PORTAL_STATES.COLD, PORTAL_STATES.WARM, PORTAL_STATES.STREAMING]),
  [PORTAL_STATES.STREAMING]: new Set([PORTAL_STATES.COLD, PORTAL_STATES.WARM, PORTAL_STATES.STREAMING])
}

export const canTransitionPortalState = (fromState: PortalState, toState: PortalState): boolean => {
  return PORTAL_TRANSITIONS[fromState]?.has(toState) ?? false
}
