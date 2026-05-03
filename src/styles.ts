/** Border + background shared by all settings form controls */
export const SETTINGS_CONTROL_BASE = 'border border-border-medium bg-surface-btn-secondary'

/** Vertical sizing (py + text-size + line-height) shared by settings controls.
 *  Apply to buttons placed alongside SettingsTextInput / SettingsSelect to keep
 *  their heights aligned automatically. */
export const SETTINGS_CONTROL_VMETRICS = 'py-[0.55cqh] text-[2.67cqh] leading-[1.2]'

/** Font + layout + padding for settings inputs */
export const SETTINGS_CONTROL_TEXT = `font-serif text-left text-text-primary px-[1.42cqh] ${SETTINGS_CONTROL_VMETRICS}`

/** Outline hover interaction for settings controls */
export const SETTINGS_OUTLINE_HOVER =
  'outline-0 outline-border-medium transition-[outline-width] duration-150 hover:outline-2'

/** Shared heading base: tight leading so subtitles sit close */
export const HEADING_BASE = 'm-0 font-serif leading-[0.95]'

/** Shared font base for settings labels and descriptions */
export const SETTINGS_LABEL_BASE = 'font-serif text-[2.4cqh]'

/** Muted description/label text */
export const SETTINGS_MUTED_TEXT = `${SETTINGS_LABEL_BASE} text-text-muted`

/** Muted description/label text without font size override */
export const SETTINGS_MUTED_TEXT_WITHOUT_FONT_SIZE = `font-serif text-text-muted`

/** Styled scrollbar class for scrollable panels and dropdowns */
export const STYLED_SCROLLBAR = 'styled-scrollbar'

/** Full-width view heading (pause, scenes, settings) */
export const VIEW_HEADING = `${HEADING_BASE} text-heading text-text-primary font-normal text-left`

/** Muted subtitle below a view heading */
export const VIEW_DESCRIPTION = 'm-0 font-serif text-caption text-text-muted max-w-[103.12cqh] text-left'
