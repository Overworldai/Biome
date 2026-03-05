import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { getHiddenWindowOptions } from './platform.js'
import { emitToAllWindows } from './ipcUtils.js'

export async function runUvSyncWithMirroredLogs(
  uvBinary: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  options?: { logPrefix?: string; emitToUi?: boolean }
): Promise<void> {
  const prefix = options?.logPrefix ?? '[UV]'
  const emitToUi = options?.emitToUi ?? false

  await new Promise<void>((resolve, reject) => {
    const child = spawn(uvBinary, ['sync', '--verbose', '--index-strategy', 'unsafe-best-match'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...getHiddenWindowOptions()
    })

    const tail: string[] = []
    const handleLine = (line: string, isStderr: boolean) => {
      const prefixed = `${prefix} ${line}`
      if (isStderr) {
        console.error(prefixed)
      } else {
        console.log(prefixed)
      }
      if (emitToUi) {
        emitToAllWindows('server-log', prefixed)
      }
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

    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`uv sync failed (exit ${code ?? 'unknown'})\n${tail.join('\n')}`))
    })
  })
}
