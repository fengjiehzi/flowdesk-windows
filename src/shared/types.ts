import type { IslandState } from './islandState'
import type { IslandSettings } from './settings'

export type IslandSnapshot = {
  state: IslandState
  settings: IslandSettings
  now: string
}
