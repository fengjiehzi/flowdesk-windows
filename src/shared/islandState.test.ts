import assert from 'node:assert/strict'
import { nextIslandState } from './islandState'

assert.equal(nextIslandState('HIDDEN', 'SHOW_COMPACT'), 'ENTERING')
assert.equal(nextIslandState('ENTERING', 'ENTER_DONE'), 'COMPACT')
assert.equal(nextIslandState('ENTERING', 'EXPAND'), 'EXPANDED')
assert.equal(nextIslandState('COMPACT', 'EXPAND'), 'EXPANDED')
assert.equal(nextIslandState('EXPANDED', 'OPEN_SETTINGS'), 'SETTINGS_OPEN')
assert.equal(nextIslandState('SETTINGS_OPEN', 'CLOSE_SETTINGS'), 'EXPANDED')
assert.equal(nextIslandState('COLLAPSING', 'REENTER'), 'EXPANDED')
assert.equal(nextIslandState('COLLAPSING', 'COLLAPSE_DONE'), 'COMPACT')
assert.equal(nextIslandState('HIDDEN', 'EXPAND'), 'HIDDEN')

console.log('island state self-check passed')
