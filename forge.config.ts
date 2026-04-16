import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import MakerNSIS from '@felixrieseberg/electron-forge-maker-nsis'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerAppImage } from '@reforged/maker-appimage'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'biome',
    icon: './app-icon',
    appCopyright: 'Copyright © 2026 Overworld',
    extraResource: [
      './server-components',
      './seeds',
      './licensing',
      './backgrounds',
      './app-icon.ico',
      './app-icon.png'
    ]
  },
  makers: [
    new MakerNSIS({
      getAppBuilderConfig: async () => ({
        publish: null,
        win: {
          icon: 'app-icon.ico',
          publisherName: 'Overworld'
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          uninstallDisplayName: 'Biome',
          license: 'licensing/EULA.txt',
          include: 'build/installer.nsh',
          installerIcon: 'app-icon.ico',
          uninstallerIcon: 'app-icon.ico'
        }
      })
    }),
    new MakerDMG({}),
    new MakerAppImage({})
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'electron/main.ts',
          config: 'vite.main.config.ts',
          target: 'main'
        },
        {
          entry: 'electron/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload'
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts'
        }
      ]
    })
  ],
  hooks: {
    // Fetch AppImage post-processing tools (linuxdeploy, appimagetool, zig).
    // Idempotent — skips items already in build/appimage/.cache or toolchain/.
    // Only does work on Linux builds.
    generateAssets: async (_config, platform) => {
      if (platform !== 'linux') return
      runNodeScript('scripts/appimage-prepare-assets.mjs')
    },
    // Post-process the produced .AppImage: bundle GTK/X11 deps via linuxdeploy,
    // install the Zig toolchain + AppRun wrapper, re-squash with appimagetool.
    postMake: async (_config, makeResults) => {
      if (process.platform !== 'linux') return makeResults
      const mod = await import('./scripts/appimage-post-make.mjs')
      return await mod.default(makeResults)
    }
  }
}

function runNodeScript(relativePath: string): void {
  const scriptPath = resolve(__dirname, relativePath)
  const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${relativePath} exited with status ${result.status}`)
  }
}

export default config
