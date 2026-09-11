import type { IslandState } from './islandState'

export type IslandSurface = 'compact' | 'panel'
export type SurfaceVisibility = Readonly<Record<IslandSurface, boolean>>

const hidden: SurfaceVisibility = { compact: false, panel: false }
const compact: SurfaceVisibility = { compact: true, panel: false }
const panel: SurfaceVisibility = { compact: false, panel: true }

export function visibleSurfacesForState(state: IslandState): SurfaceVisibility {
  if (state === 'HIDDEN') return hidden
  if (state === 'ENTERING' || state === 'COMPACT' || state === 'COLLAPSING') return compact
  return panel
}

export function isSurfaceActive(surface: IslandSurface, state: IslandState) {
  return visibleSurfacesForState(state)[surface]
}

export type SurfaceWindowMode = 'active' | 'hidden'

export function surfaceWindowMode(
  surface: IslandSurface,
  state: IslandState,
  notificationVisible: boolean
): SurfaceWindowMode {
  if (notificationVisible) return surface === 'compact' ? 'active' : 'hidden'
  if (isSurfaceActive(surface, state)) return 'active'
  return 'hidden'
}

export function pointInRectangle(point: Electron.Point, rectangle: Electron.Rectangle) {
  return point.x >= rectangle.x
    && point.x < rectangle.x + rectangle.width
    && point.y >= rectangle.y
    && point.y < rectangle.y + rectangle.height
}
