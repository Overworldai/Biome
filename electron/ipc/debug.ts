import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { execSync } from 'node:child_process'

function resolveCommitHash(): string {
  const envCommit =
    process.env.BIOME_COMMIT_HASH || process.env.GIT_COMMIT || process.env.VITE_GIT_COMMIT || process.env.COMMIT_HASH
  if (envCommit && envCommit.trim().length > 0) {
    return envCommit.trim()
  }

  try {
    return execSync('git rev-parse HEAD', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf-8')
      .trim()
  } catch {
    return 'unknown'
  }
}

export function registerDebugIpc(): void {
  ipcMain.handle('write-spark-tuning', async (_event, tuning: Record<string, number>) => {
    const targetPath = path.resolve(process.cwd(), 'src', 'lib', 'portalSparksTuning.json')
    await fs.promises.writeFile(targetPath, JSON.stringify(tuning, null, 2) + '\n', 'utf-8')
  })

  ipcMain.handle('get-runtime-diagnostics-meta', () => {
    return {
      app_name: app.getName(),
      app_version: app.getVersion(),
      commit_hash: resolveCommitHash(),
      platform: process.platform,
      arch: process.arch,
      electron_version: process.versions.electron || 'unknown',
      chrome_version: process.versions.chrome || 'unknown',
      node_version: process.versions.node || 'unknown',
      locale: app.getLocale(),
      is_packaged: app.isPackaged
    }
  })

  ipcMain.handle('export-loading-diagnostics', async (_event, reportText: string) => {
    const parentWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const defaultPath = path.join(app.getPath('documents'), `biome-loading-diagnostics-${timestamp}.json`)

    const saveResult = await dialog.showSaveDialog(parentWindow, {
      title: 'Export loading diagnostics',
      defaultPath,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true, file_path: null }
    }

    await fs.promises.writeFile(saveResult.filePath, reportText, 'utf-8')
    return { canceled: false, file_path: saveResult.filePath }
  })
}
