import assert from 'node:assert/strict'
import { isSurfaceActive, pointInRectangle, triggerExitDecision, visibleSurfacesForState } from './islandPresentation'

assert.deepEqual(visibleSurfacesForState('HIDDEN'), { trigger: false, compact: false, panel: false })
assert.deepEqual(visibleSurfacesForState('TRIGGER_VISIBLE'), { trigger: true, compact: false, panel: false })
assert.deepEqual(visibleSurfacesForState('ENTERING'), { trigger: false, compact: true, panel: false })
assert.deepEqual(visibleSurfacesForState('COMPACT'), { trigger: false, compact: true, panel: false })
assert.deepEqual(visibleSurfacesForState('COLLAPSING'), { trigger: false, compact: true, panel: false })
assert.deepEqual(visibleSurfacesForState('EXPANDED'), { trigger: false, compact: false, panel: true })
assert.deepEqual(visibleSurfacesForState('SETTINGS_OPEN'), { trigger: false, compact: false, panel: true })
assert.equal(isSurfaceActive('trigger', 'TRIGGER_VISIBLE'), true)
assert.equal(isSurfaceActive('compact', 'COMPACT'), true)
assert.equal(isSurfaceActive('panel', 'COMPACT'), false)
assert.equal(isSurfaceActive('panel', 'COLLAPSING'), false)
assert.equal(pointInRectangle({ x: -100, y: 20 }, { x: -100, y: 20, width: 164, height: 56 }), true)
assert.equal(pointInRectangle({ x: 63, y: 75 }, { x: -100, y: 20, width: 164, height: 56 }), true)
assert.equal(pointInRectangle({ x: 64, y: 75 }, { x: -100, y: 20, width: 164, height: 56 }), false)
assert.equal(pointInRectangle({ x: 63, y: 76 }, { x: -100, y: 20, width: 164, height: 56 }), false)

const firstExit = triggerExitDecision(false, false, false, null, 1_000)
assert.deepEqual(firstExit, { outsideSince: 1_000, hide: false })
assert.deepEqual(triggerExitDecision(false, false, false, firstExit.outsideSince, 1_799), {
  outsideSince: 1_000,
  hide: false
})
assert.deepEqual(triggerExitDecision(false, false, false, firstExit.outsideSince, 1_800), {
  outsideSince: 1_000,
  hide: true
})
assert.deepEqual(triggerExitDecision(true, false, false, firstExit.outsideSince, 1_800), {
  outsideSince: null,
  hide: false
})
assert.deepEqual(triggerExitDecision(false, true, false, firstExit.outsideSince, 1_800), {
  outsideSince: null,
  hide: false
})
assert.deepEqual(triggerExitDecision(false, false, true, firstExit.outsideSince, 1_800), {
  outsideSince: null,
  hide: false
})
const reentered = triggerExitDecision(true, false, false, firstExit.outsideSince, 1_400)
assert.deepEqual(triggerExitDecision(false, false, false, reentered.outsideSince, 1_500), {
  outsideSince: 1_500,
  hide: false
})

console.log('island presentation self-check passed')
