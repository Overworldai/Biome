import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { getHiddenWindowOptions } from './platform.js'

export async function runUvSyncWithMirroredLogs(
  uvBinary: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  options?: { logPrefix?: string; signal?: AbortSignal; onLine?: (line: string, isStderr: boolean) => void }
): Promise<void> {
  const prefix = options?.logPrefix ?? '[UV]'
  const signal = options?.signal
  const onLine = options?.onLine

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Engine setup canceled by user'))
      return
    }

    const child = spawn(uvBinary, ['sync', '--verbose', '--index-strategy', 'unsafe-best-match'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...getHiddenWindowOptions()
    })
    let aborted = false

    const tail: string[] = []
    const handleLine = (line: string, isStderr: boolean) => {
      const prefixed = `${prefix} ${line}`
      if (isStderr) {
        console.error(prefixed)
      } else {
        console.log(prefixed)
      }
      onLine?.(prefixed, isStderr)
      tail.push(prefixed)
      if (tail.length > 80) tail.shift()
    }

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => handleLine(line, false))
    }
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr })
      rl.on('line', (line) => handleLine(line, true))
    }

    const handleAbort = () => {
      aborted = true
      child.kill()
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      signal?.removeEventListener('abort', handleAbort)
      if (aborted) {
        reject(new Error('Engine setup canceled by user'))
        return
      }
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`uv sync failed (exit ${code ?? 'unknown'})\n${tail.join('\n')}`))
    })
  })
}
