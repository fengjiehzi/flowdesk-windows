import type { IslandState } from './islandState'
import type { IslandSettings } from './settings'

export type IslandPanelView = 'launcher' | 'notifications' | 'clipboard'

export type IslandSnapshot = {
  state: IslandState
  compactMode: 'clock' | 'notification'
  settings: IslandSettings
  now: string
  settingsRevision: number
  shortcutRegistered?: boolean
  panelView?: IslandPanelView
}

export type SettingsUpdateResult = { settings: IslandSettings; settingsRevision: number }
