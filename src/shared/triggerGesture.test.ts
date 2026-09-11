import assert from 'node:assert/strict'
import {
  defaultTriggerStyle,
  deriveFluxPalette,
  triggerPresetCategories,
  triggerPresets,
  triggerStyles
} from './triggerGesture'

assert.equal(defaultTriggerStyle, 'liquid-ridge')
assert.equal(triggerStyles.length, 31)
assert.equal(new Set(triggerStyles).size, 31)
assert.deepEqual(triggerPresetCategories.map((category) => category.name), [
  '经典流云', '流体材质', '实时界面', '游戏科技', '动感二次元', '花卉自然'
])
assert.deepEqual(
  triggerPresetCategories.map((category) => triggerStyles.filter((style) => triggerPresets[style].category === category.id).length),
  [3, 9, 3, 6, 5, 5]
)
assert.deepEqual(triggerPresets['liquid-ridge'].colors, ['#59D6FF', '#34D399', '#8B5CF6'])
assert.deepEqual(triggerPresets['cherry-bloom'].colors, ['#FF4F9E', '#FF8C40', '#B83DFF'])
assert.deepEqual(triggerPresets['quantum-membrane'].colors, ['#14E094', '#2E7AFF', '#8C40F2'])
assert.deepEqual(triggerPresets['overclock-reactor'].colors, ['#002EA6', '#2140D9', '#FF5C1F'])
assert.deepEqual(triggerPresets['star-sigil'].colors, ['#7A3DFF', '#B8D43D', '#4D2BA1'])
assert.deepEqual(triggerPresets['liquid-glass'].colors, ['#212121', '#8C8C8C', '#D1D1D1'])
assert.deepEqual(triggerPresets['osmanthus-bloom'].colors, ['#FFB82E', '#FF5747', '#9E2470'])
assert.deepEqual(deriveFluxPalette('#ff4f9a'), ['#FF4F9A', '#FF8E63', '#C845FF'])
for (const style of triggerStyles) {
  assert.equal(triggerPresets[style].id, style)
  assert.equal(triggerPresets[style].colors.length, 3)
  triggerPresets[style].colors.forEach((color) => assert.match(color, /^#[0-9A-F]{6}$/))
}

console.log('FLUX preset self-check passed')
