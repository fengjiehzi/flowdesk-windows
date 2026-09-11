import type { IslandState } from './islandState'
import type { IslandSettings } from './settings'

export type IslandSnapshot = {
  state: IslandState
  compactMode: 'clock' | 'notification'
  settings: IslandSettings
  now: string
}
