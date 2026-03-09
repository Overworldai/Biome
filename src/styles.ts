/** Border + background shared by all settings form controls */
export const SETTINGS_CONTROL_BASE = 'border border-border-medium bg-surface-btn-ghost'

/** Font + layout + padding for settings inputs */
export const SETTINGS_CONTROL_TEXT =
  'font-serif leading-[1.2] text-left text-text-primary p-[0.55cqh_1.42cqh] text-[2.67cqh]'

/** Outline hover interaction for settings controls */
export const SETTINGS_OUTLINE_HOVER =
  'outline-0 outline-border-medium transition-[outline-width] duration-150 hover:outline-2'

/** Shared heading base: tight leading so subtitles sit close */
export const HEADING_BASE = 'm-0 font-serif leading-[0.95]'

/** Shared font base for settings labels and descriptions */
export const SETTINGS_LABEL_BASE = 'font-serif text-[2.4cqh]'

/** Muted description/label text */
export const SETTINGS_MUTED_TEXT = `${SETTINGS_LABEL_BASE} text-text-muted`

/** Standard hover transition for standalone buttons */
export const INTERACTIVE_TRANSITION = 'transition-[color,background-color,border-color,outline-width] ease-in-out'

/** Shared base for confirm modal buttons */
export const CONFIRM_BUTTON_BASE = 'cursor-pointer font-serif p-[0.5cqh_1.78cqh] text-[2.49cqh]'

/** Compact action button for log/diagnostic panels */
export const LOG_ACTION_BUTTON =
  'cursor-pointer border border-border-medium bg-surface-btn-ghost text-text-primary font-serif text-[1.8cqh] px-[1.2cqh] py-[0.25cqh] transition-[color,background-color,border-color,outline-width] ease-in-out duration-200 hover:bg-surface-btn-hover hover:text-text-inverse'
