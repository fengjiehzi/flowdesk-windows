import assert from 'node:assert/strict'
import {
  defaultTriggerStyle,
  resolveTriggerGestureAxis,
  shouldRevealFromTrigger,
  triggerActivationLeft,
  triggerLeftFromPosition,
  triggerPresetCategories,
  triggerPresets,
  triggerPositionFromLeft,
  triggerStyleDimensions,
  triggerStyles
} from './triggerGesture'

assert.equal(shouldRevealFromTrigger(0, 0), true)
assert.equal(shouldRevealFromTrigger(2, 3), false)
assert.equal(shouldRevealFromTrigger(5, 5), false)
assert.equal(shouldRevealFromTrigger(6, 6), true)
assert.equal(shouldRevealFromTrigger(8, 12), true)
assert.equal(shouldRevealFromTrigger(0, 50), false)
assert.equal(shouldRevealFromTrigger(6, 50), true)
assert.equal(resolveTriggerGestureAxis(3, 0), null)
assert.equal(resolveTriggerGestureAxis(5, 2), 'horizontal')
assert.equal(resolveTriggerGestureAxis(2, 5), 'vertical')
assert.equal(resolveTriggerGestureAxis(5, 5), 'vertical')
assert.equal(triggerActivationLeft(0, 1920, 120), 900)
assert.equal(triggerActivationLeft(0, 1920, 320), 800)
assert.equal(triggerActivationLeft(1920, 1920, 800), 2480)
assert.equal(triggerActivationLeft(-1920, 1920, 320), -1120)
assert.equal(triggerLeftFromPosition(0, 1920, 96, 0), 12)
assert.equal(triggerLeftFromPosition(0, 1920, 96, 0.5), 912)
assert.equal(triggerLeftFromPosition(1920, 1920, 96, 1), 3732)
assert.equal(triggerLeftFromPosition(0, 1920, 96, -1), 12)
assert.equal(triggerLeftFromPosition(0, 1920, 96, 2), 1812)
assert.equal(triggerPositionFromLeft(0, 1920, 96, 912), 0.5)
assert.equal(triggerPositionFromLeft(0, 1920, 96, -100), 0)
assert.equal(defaultTriggerStyle, 'liquid-ridge')
assert.equal(triggerStyles.length, 31)
assert.equal(new Set(triggerStyles).size, 31)
assert.deepEqual(triggerPresetCategories.map((category) => category.name), [
  '经典把手', '流体材质', '实时界面', '游戏科技', '动感二次元', '花卉自然'
])
assert.deepEqual(
  triggerPresetCategories.map((category) => triggerStyles.filter((style) => triggerPresets[style].category === category.id).length),
  [3, 9, 3, 6, 5, 5]
)
assert.deepEqual(triggerStyleDimensions['liquid-ridge'], { width: 212, height: 30 })
assert.deepEqual(triggerStyleDimensions['magnetic-rail'], { width: 320, height: 30 })
assert.deepEqual(triggerStyleDimensions['edge-dock'], { width: 640, height: 30 })
for (const style of triggerStyles) {
  assert.equal(triggerPresets[style].id, style)
}

console.log('trigger gesture self-check passed')
