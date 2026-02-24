export {}

type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>

declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke: TauriInvoke
    }
    __TAURI__: {
      window: {
        getCurrentWindow: () => {
          minimize: () => Promise<void>
          maximize: () => Promise<void>
          unmaximize: () => Promise<void>
          isMaximized: () => Promise<boolean>
          close: () => Promise<void>
          setSize: (size: unknown) => Promise<void>
          innerSize: () => Promise<{ width: number; height: number }>
          outerPosition: () => Promise<{ x: number; y: number }>
          setPosition: (pos: unknown) => Promise<void>
          onResized: (fn: () => void | Promise<void>) => Promise<() => void>
        }
      }
      dpi: {
        LogicalSize: new (width: number, height: number) => unknown
        LogicalPosition: new (x: number, y: number) => unknown
      }
    }
    __biomeLog?: {
      setLogLevel: (level: string) => void
      getLogLevel: () => string
      LOG_LEVELS: Record<string, number>
    }
  }
}
