import assert from 'node:assert/strict'
import { isSurfaceActive, pointInRectangle, surfaceWindowMode, visibleSurfacesForState } from './islandPresentation'

assert.deepEqual(visibleSurfacesForState('HIDDEN'), { compact: false, panel: false })
assert.deepEqual(visibleSurfacesForState('ENTERING'), { compact: true, panel: false })
assert.deepEqual(visibleSurfacesForState('COMPACT'), { compact: true, panel: false })
assert.deepEqual(visibleSurfacesForState('COLLAPSING'), { compact: true, panel: false })
assert.deepEqual(visibleSurfacesForState('EXPANDED'), { compact: false, panel: true })
assert.deepEqual(visibleSurfacesForState('SETTINGS_OPEN'), { compact: false, panel: true })
assert.equal(isSurfaceActive('compact', 'COMPACT'), true)
assert.equal(isSurfaceActive('panel', 'COMPACT'), false)
assert.equal(isSurfaceActive('panel', 'COLLAPSING'), false)
assert.equal(surfaceWindowMode('compact', 'HIDDEN', false), 'hidden')
assert.equal(surfaceWindowMode('compact', 'HIDDEN', true), 'active')
assert.equal(surfaceWindowMode('panel', 'EXPANDED', true), 'hidden')
assert.equal(surfaceWindowMode('compact', 'COMPACT', false), 'active')
assert.equal(surfaceWindowMode('panel', 'EXPANDED', false), 'active')
assert.equal(pointInRectangle({ x: -100, y: 20 }, { x: -100, y: 20, width: 164, height: 56 }), true)
assert.equal(pointInRectangle({ x: 63, y: 75 }, { x: -100, y: 20, width: 164, height: 56 }), true)
assert.equal(pointInRectangle({ x: 64, y: 75 }, { x: -100, y: 20, width: 164, height: 56 }), false)
assert.equal(pointInRectangle({ x: 63, y: 76 }, { x: -100, y: 20, width: 164, height: 56 }), false)

console.log('island presentation self-check passed')
