import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import MakerNSIS from '@felixrieseberg/electron-forge-maker-nsis'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerAppImage } from '@reforged/maker-appimage'

const shouldSignMac =
  process.platform === 'darwin' && (Boolean(process.env.CSC_LINK) || Boolean(process.env.MAC_CODESIGN_IDENTITY))

const shouldNotarizeMac =
  shouldSignMac &&
  Boolean(process.env.APPLE_ID) &&
  Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD) &&
  Boolean(process.env.APPLE_TEAM_ID)

const macNotarizeCredentials = shouldNotarizeMac
  ? {
      appleId: process.env.APPLE_ID as string,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD as string,
      teamId: process.env.APPLE_TEAM_ID as string
    }
  : undefined

const extraResources = [
  ...(process.platform === 'darwin' ? [] : ['./server-components']),
  './seeds',
  './licensing',
  './backgrounds',
  './app-icon.ico',
  './app-icon.png'
]

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'biome',
    appBundleId: 'ai.overworld.biome',
    appCategoryType: 'public.app-category.games',
    icon: './app-icon',
    appCopyright: 'Copyright (c) 2026 Overworld',
    extraResource: extraResources,
    osxSign: shouldSignMac
      ? {
          identity: process.env.MAC_CODESIGN_IDENTITY || undefined,
          optionsForFile: () => ({
            hardenedRuntime: true,
            entitlements: 'build/entitlements.mac.plist'
          })
        }
      : undefined,
    osxNotarize: macNotarizeCredentials
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
  ]
}

export default config
