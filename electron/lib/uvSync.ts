import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { getHiddenWindowOptions } from './platform.js'

export async function runUvSyncWithMirroredLogs(
  uvBinary: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  options?: { signal?: AbortSignal; onLine?: (line: string, isStderr: boolean) => void }
): Promise<void> {
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
      // Subprocess pass-through: write the raw uv line to our stdout/stderr.
      // The renderer-bound `LogRecord` is built by the caller's `onLine`
      // (which routes through `parseLogLine` with `engine.uv-sync` as the
      // fallback logger), so attribution lives on the structured field
      // rather than as a glued-on prefix.
      const sink = isStderr ? process.stderr : process.stdout
      sink.write(line + '\n')
      onLine?.(line, isStderr)
      tail.push(line)
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
