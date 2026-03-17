/** View key constants for PauseOverlay */
export const PAUSE_VIEW = {
  MAIN: 'pause-main',
  SCENES: 'pause-scenes',
  SETTINGS: 'pause-settings'
} as const
export type PauseViewKey = (typeof PAUSE_VIEW)[keyof typeof PAUSE_VIEW]

/** View key constants for main menu */
export const MENU_VIEW = {
  HOME: 'menu-home',
  SETTINGS: 'menu-settings'
} as const
export type MenuViewKey = (typeof MENU_VIEW)[keyof typeof MENU_VIEW]

/** Show the portal sparks tuning configurator on the home page. */
export const PORTAL_SPARKS_DEBUG = false
