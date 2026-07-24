import type { IslandState } from './islandState'

export type IslandSurface = 'trigger' | 'compact' | 'panel'
export type SurfaceVisibility = Readonly<Record<IslandSurface, boolean>>

const hidden: SurfaceVisibility = { trigger: false, compact: false, panel: false }
const trigger: SurfaceVisibility = { trigger: true, compact: false, panel: false }
const compact: SurfaceVisibility = { trigger: false, compact: true, panel: false }
const panel: SurfaceVisibility = { trigger: false, compact: false, panel: true }

export function visibleSurfacesForState(state: IslandState): SurfaceVisibility {
  if (state === 'HIDDEN') return hidden
  if (state === 'TRIGGER_VISIBLE') return trigger
  if (state === 'ENTERING' || state === 'COMPACT' || state === 'COLLAPSING') return compact
  return panel
}

export function isSurfaceActive(surface: IslandSurface, state: IslandState) {
  return visibleSurfacesForState(state)[surface]
}

export function pointInRectangle(point: Electron.Point, rectangle: Electron.Rectangle) {
  return point.x >= rectangle.x
    && point.x < rectangle.x + rectangle.width
    && point.y >= rectangle.y
    && point.y < rectangle.y + rectangle.height
}

export function triggerExitDecision(
  insideTopZone: boolean,
  insideWindow: boolean,
  dragging: boolean,
  outsideSince: number | null,
  now: number,
  delayMs = 800
) {
  if (dragging || insideTopZone || insideWindow) return { outsideSince: null, hide: false }
  const startedAt = outsideSince ?? now
  return { outsideSince: startedAt, hide: now - startedAt >= delayMs }
}
