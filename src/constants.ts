/** View key constants for PauseOverlay */
export const PAUSE_VIEW = {
  MAIN: 'pause-main',
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

/** Allow users to add their own scenes via drag-and-drop, paste, or file picker. */
export const ALLOW_USER_SCENES = import.meta.env.DEV

/** Show debug info (edit prompt toast + before/after preview) for scene edits. */
export const SCENE_EDIT_DEBUG_PREVIEW = false

/** How long (ms) to show the edit prompt toast at the bottom of the screen. */
export const SCENE_EDIT_PROMPT_TOAST_MS = 2500

/** How long (ms) to show the before/after debug preview (2× prompt toast by default). */
export const SCENE_EDIT_PREVIEW_TOAST_MS = SCENE_EDIT_PROMPT_TOAST_MS * 2
