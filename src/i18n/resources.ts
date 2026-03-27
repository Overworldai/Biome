import en from './en'
import ja from './ja'
import zh from './zh'

export const resources = {
  en,
  ja,
  zh
} as const

export type TranslationResources = typeof resources
