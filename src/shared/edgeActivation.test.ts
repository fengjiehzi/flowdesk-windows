import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextTopEdgeHover, topEdgeBounds, topEdgeDwellMs } from './edgeActivation'
import { pointInRectangle } from './islandPresentation'

test('top edge activation requires a continuous dwell and only fires once until the pointer leaves', () => {
  let result = nextTopEdgeHover(null, 1, 1000)
  assert.equal(result.activate, false)
  result = nextTopEdgeHover(result.hover, 1, 1000 + topEdgeDwellMs - 1)
  assert.equal(result.activate, false)
  result = nextTopEdgeHover(result.hover, 1, 1000 + topEdgeDwellMs)
  assert.equal(result.activate, true)
  result = nextTopEdgeHover(result.hover, 1, 5000)
  assert.equal(result.activate, false)
  result = nextTopEdgeHover(result.hover, null, 5100)
  assert.equal(result.hover, null)
  result = nextTopEdgeHover(result.hover, 1, 5200)
  assert.equal(result.activate, false)
  result = nextTopEdgeHover(result.hover, 1, 5200 + topEdgeDwellMs)
  assert.equal(result.activate, true)
})

test('leaving early or moving to another display restarts the dwell', () => {
  let result = nextTopEdgeHover(null, 1, 1000)
  result = nextTopEdgeHover(result.hover, null, 1300)
  result = nextTopEdgeHover(result.hover, 1, 1400)
  result = nextTopEdgeHover(result.hover, 2, 1500)
  assert.equal(result.activate, false)
  assert.equal(result.hover?.enteredAt, 1500)
  result = nextTopEdgeHover(result.hover, 2, 1500 + topEdgeDwellMs - 1)
  assert.equal(result.activate, false)
  result = nextTopEdgeHover(result.hover, 2, 1500 + topEdgeDwellMs)
  assert.equal(result.activate, true)
})

test('the activation region follows the island position and uses the physical top edge on each display', () => {
  const display = {
    bounds: { x: -1920, y: -1080, width: 1920, height: 1080 },
    workArea: { x: -1920, y: -1040, width: 1920, height: 1040 }
  }
  const center = topEdgeBounds(display, 'center')
  assert.deepEqual(center, { x: -1040, y: -1080, width: 160, height: 3 })
  assert.equal(pointInRectangle({ x: -1000, y: -1080 }, center), true)
  assert.equal(pointInRectangle({ x: -1000, y: -1077 }, center), false)
  assert.equal(pointInRectangle({ x: -1200, y: -1080 }, center), false)
  assert.equal(topEdgeBounds(display, 'left').x, -1896)
  assert.equal(topEdgeBounds(display, 'right').x, -184)
  assert.deepEqual(topEdgeBounds({ bounds: { x: 0, y: 0, width: 100, height: 100 }, workArea: { x: 0, y: 0, width: 100, height: 100 } }, 'right'), {
    x: 0, y: 0, width: 100, height: 3
  })
})
