import { registerSettingsIpc } from './settings.js'
import { registerBackgroundsIpc } from './backgrounds.js'
import { registerSeedsIpc } from './seeds.js'
import { registerModelsIpc } from './models.js'
import { registerEngineIpc } from './engine.js'
import { registerServerIpc } from './server.js'
import { registerWindowIpc } from './window.js'
import { registerDebugIpc } from './debug.js'
import { registerUpdateIpc } from './update.js'

export function registerAllIpc(): void {
  registerSettingsIpc()
  registerBackgroundsIpc()
  registerSeedsIpc()
  registerModelsIpc()
  registerEngineIpc()
  registerServerIpc()
  registerWindowIpc()
  registerDebugIpc()
  registerUpdateIpc()
}
