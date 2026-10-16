type Rectangle = { x: number; y: number; width: number; height: number }
type DisplayArea = { bounds: Rectangle; workArea: Rectangle }
export type TopEdgeHover = { displayId: number; enteredAt: number; triggered: boolean }

export const topEdgeDwellMs = 450

export function topEdgeBounds(display: DisplayArea, position: 'left' | 'center' | 'right'): Rectangle {
  const area = display.workArea
  const width = Math.min(160, area.width)
  let x = area.x + (area.width - width) / 2
  if (position === 'left') x = area.x + 24
  if (position === 'right') x = area.x + area.width - width - 24
  x = Math.max(area.x, Math.min(x, area.x + area.width - width))
  return { x: Math.round(x), y: display.bounds.y, width, height: 3 }
}

export function nextTopEdgeHover(previous: TopEdgeHover | null, displayId: number | null, now: number) {
  if (displayId === null) return { hover: null, activate: false }
  const hover = previous?.displayId === displayId
    ? previous
    : { displayId, enteredAt: now, triggered: false }
  const activate = !hover.triggered && now - hover.enteredAt >= topEdgeDwellMs
  return { hover: activate ? { ...hover, triggered: true } : hover, activate }
}
