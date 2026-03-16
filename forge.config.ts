import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import MakerNSIS from '@felixrieseberg/electron-forge-maker-nsis'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerAppImage } from '@reforged/maker-appimage'

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
  ]
}

export default config
