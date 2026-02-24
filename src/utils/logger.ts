const isDev = import.meta.env?.DEV ?? true

const LOG_LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4 } as const

type LogLevelName = keyof typeof LOG_LEVELS

type Logger = {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  time: (label: string) => () => void
  group: (label: string, fn: () => void) => void
}

let globalLevel: number = isDev ? LOG_LEVELS.debug : LOG_LEVELS.warn

if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('biome_log_level') as LogLevelName | null
  if (stored && LOG_LEVELS[stored] !== undefined) {
    globalLevel = LOG_LEVELS[stored]
  }
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

let colorIndex = 0
const moduleColors = new Map<string, string>()

function getModuleColor(module: string): string {
  if (!moduleColors.has(module)) {
    moduleColors.set(module, COLORS[colorIndex % COLORS.length])
    colorIndex++
  }
  return moduleColors.get(module) ?? COLORS[0]
}

function formatTime(): string {
  const now = new Date()
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`
}

export function createLogger(module: string): Logger {
  const color = getModuleColor(module)
  const prefix = `%c[${module}]`
  const prefixStyle = `color: ${color}; font-weight: bold`
  const timeStyle = 'color: #6b7280; font-weight: normal'

  return {
    debug: (...args: unknown[]) => {
      if (globalLevel >= LOG_LEVELS.debug) {
        console.debug(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, ...args)
      }
    },
    info: (...args: unknown[]) => {
      if (globalLevel >= LOG_LEVELS.info) {
        console.info(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, ...args)
      }
    },
    warn: (...args: unknown[]) => {
      if (globalLevel >= LOG_LEVELS.warn) {
        console.warn(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, ...args)
      }
    },
    error: (...args: unknown[]) => {
      if (globalLevel >= LOG_LEVELS.error) {
        console.error(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, ...args)
      }
    },
    time: (label: string) => {
      const start = performance.now()
      return () => {
        const elapsed = (performance.now() - start).toFixed(2)
        if (globalLevel >= LOG_LEVELS.debug) {
          console.debug(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, `${label} took ${elapsed}ms`)
        }
      }
    },
    group: (label: string, fn: () => void) => {
      if (globalLevel >= LOG_LEVELS.debug) {
        console.groupCollapsed(`%c${formatTime()} ${prefix}`, timeStyle, prefixStyle, label)
        fn()
        console.groupEnd()
      }
    }
  }
}

export function setLogLevel(level: LogLevelName): void {
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

export function getLogLevel(): string {
  return Object.entries(LOG_LEVELS).find(([, v]) => v === globalLevel)?.[0] ?? 'unknown'
}

if (typeof window !== 'undefined') {
  window.__biomeLog = { setLogLevel: setLogLevel as (level: string) => void, getLogLevel, LOG_LEVELS }
}

export default createLogger
