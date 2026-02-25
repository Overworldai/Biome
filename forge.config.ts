import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerDeb } from '@electron-forge/maker-deb'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: ['./src-tauri/server-components', './seeds']
  },
  makers: [new MakerSquirrel({}), new MakerDMG({}), new MakerDeb({})],
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
