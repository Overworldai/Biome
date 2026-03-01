export {}

declare global {
  interface Window {
    electronAPI: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>
      on(channel: string, callback: (...args: unknown[]) => void): () => void
    }
    __biomeLog?: {
      setLogLevel: (level: string) => void
      getLogLevel: () => string
      LOG_LEVELS: Record<string, number>
    }
  }
}
