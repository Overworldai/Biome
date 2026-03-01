/** Border + background shared by all settings form controls */
export const SETTINGS_CONTROL_BASE = 'border border-[rgba(245,251,255,0.75)] bg-[rgba(8,12,20,0.28)]'

/** Font + layout + padding for settings inputs */
export const SETTINGS_CONTROL_TEXT =
  'font-serif leading-[1.2] text-right text-[rgba(245,249,255,0.92)] p-[0.55cqh_1.42cqh] text-[2.67cqh]'

/** Outline hover interaction for settings controls */
export const SETTINGS_OUTLINE_HOVER =
  'outline-0 outline-[rgba(245,251,255,0.75)] transition-[outline-width] duration-150 hover:outline-2'

/** Muted description/label text */
export const SETTINGS_MUTED_TEXT = 'font-serif text-[rgba(238,244,252,0.66)] text-[2.4cqh]'

/** Shared base for minimize/close window buttons */
export const WINDOW_CONTROL_BASE =
  'flex items-center justify-center w-[23px] h-4 m-0 p-0 rounded-sm text-[9px] leading-none cursor-pointer bg-[rgba(8,12,20,0.28)] text-text-secondary font-serif border border-[rgba(245,251,255,0.8)]'

/** Standard hover transition for standalone buttons */
export const INTERACTIVE_TRANSITION = 'transition-[color,background-color,border-color,outline-width] ease-in-out'

/** Shared base for confirm modal buttons */
export const CONFIRM_BUTTON_BASE = 'cursor-pointer font-serif p-[0.5cqh_1.78cqh] text-[2.49cqh]'
