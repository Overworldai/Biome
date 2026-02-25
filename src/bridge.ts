import type { IpcCommandMap, IpcEventMap } from './types/ipc'

declare global {
  interface Window {
    electronAPI: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>
      on(channel: string, callback: (...args: unknown[]) => void): () => void
    }
  }
}

/**
 * Typed invoke wrapper for IPC commands.
 * Positional args are passed directly to the main process handler.
 */
export async function invoke<C extends keyof IpcCommandMap>(
  channel: C,
  ...args: IpcCommandMap[C]['args']
): Promise<IpcCommandMap[C]['return']> {
  return window.electronAPI.invoke(channel, ...args) as Promise<IpcCommandMap[C]['return']>
}

/**
 * Typed event listener for IPC events from the main process.
 * Returns an unlisten function.
 */
export function listen<E extends keyof IpcEventMap>(event: E, callback: (payload: IpcEventMap[E]) => void): () => void {
  return window.electronAPI.on(event, (...args: unknown[]) => {
    callback(args[0] as IpcEventMap[E])
  })
}
