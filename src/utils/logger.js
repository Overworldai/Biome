/**
 * Dev logger for Biome
 *
 * Usage:
 *   import { createLogger } from '../utils/logger'
 *   const log = createLogger('WebRTC')
 *   log.info('Connected')
 *   log.debug('Candidate:', candidate)
 *   log.warn('Retrying...')
 *   log.error('Failed:', error)
 */

const isDev = import.meta.env?.DEV ?? process.env.NODE_ENV !== 'production'

// Log levels: 0=off, 1=error, 2=warn, 3=info, 4=debug
const LOG_LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4 }

// Default level (can be overridden via localStorage)
let globalLevel = isDev ? LOG_LEVELS.debug : LOG_LEVELS.warn

// Check localStorage for override
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('biome_log_level')
  if (stored && LOG_LEVELS[stored] !== undefined) {
    globalLevel = LOG_LEVELS[stored]
  }
}

// Colors for different modules (cycles through)
const COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4' // cyan
]

let colorIndex = 0
const moduleColors = new Map()

function getModuleColor(module) {
  if (!moduleColors.has(module)) {
    moduleColors.set(module, COLORS[colorIndex % COLORS.length])
    colorIndex++
  }
  return moduleColors.get(module)
}

function formatTime() {
  const now = new Date()
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`
}

export function createLogger(module) {
  const color = getModuleColor(module)
  const prefix = `%c[${module}]`
  const prefixStyle = `color: ${color}; font-weight: bold`
  const timeStyle = 'color: #6b7280; font-weight: normal'

  return {
    debug: (...args) => {
      if (globalLevel >= LOG_LEVELS.debug) {
        console.debug(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, ...args)
      }
    },
    info: (...args) => {
      if (globalLevel >= LOG_LEVELS.info) {
        console.info(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, ...args)
      }
    },
    warn: (...args) => {
      if (globalLevel >= LOG_LEVELS.warn) {
        console.warn(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, ...args)
      }
    },
    error: (...args) => {
      if (globalLevel >= LOG_LEVELS.error) {
        console.error(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, ...args)
      }
    },
    // Log with timing - returns a function to call when done
    time: (label) => {
      const start = performance.now()
      return () => {
        const elapsed = (performance.now() - start).toFixed(2)
        if (globalLevel >= LOG_LEVELS.debug) {
          console.debug(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, `${label} took ${elapsed}ms`)
        }
      }
    },
    // Group logs together
    group: (label, fn) => {
      if (globalLevel >= LOG_LEVELS.debug) {
        console.groupCollapsed(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, label)
        fn()
        console.groupEnd()
      }
    }
  }
}

// Global functions to control logging at runtime
export function setLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    globalLevel = LOG_LEVELS[level]
    if (typeof window !== 'undefined') {
      localStorage.setItem('biome_log_level', level)
    }
    console.info(`Log level set to: ${level}`)
  } else {
    console.error(`Invalid log level: ${level}. Use: off, error, warn, info, debug`)
  }
}

export function getLogLevel() {
  return Object.entries(LOG_LEVELS).find(([, v]) => v === globalLevel)?.[0] ?? 'unknown'
}

// Expose to window for runtime debugging
if (typeof window !== 'undefined') {
  window.__biomeLog = { setLogLevel, getLogLevel, LOG_LEVELS }
}

export default createLogger
