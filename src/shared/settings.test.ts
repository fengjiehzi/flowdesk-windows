import assert from 'node:assert/strict'
import { applySettingsPatch, defaultSettings, settingsSchema } from './settings'

const legacy = settingsSchema.parse({ theme: 'graphite', triggerPosition: 0.2 })
assert.deepEqual(legacy.fluidCloud, defaultSettings.fluidCloud)
assert.deepEqual(legacy.fluidCloudCreations, [])
assert.equal(legacy.triggerPosition, 0.2)
assert.equal(legacy.triggerWidth, 320)
assert.equal(settingsSchema.safeParse({ ...defaultSettings, triggerWidth: 119 }).success, false)
assert.equal(settingsSchema.safeParse({ ...defaultSettings, triggerWidth: 801 }).success, false)

const customized = applySettingsPatch(defaultSettings, {
  fluidCloud: { strands: 8, particles: 14, speed: 1.6 }
})
const recolored = applySettingsPatch(customized, { fluidCloud: { color: '#ff4f9a' } })
const resized = applySettingsPatch(defaultSettings, {
  fluidCloud: { shape: 'cherry-bloom', widthScale: 580 / 560, heightScale: 1 }
})

assert.equal(recolored.fluidCloud.color, '#ff4f9a')
assert.equal(recolored.fluidCloud.strands, 8)
assert.equal(recolored.fluidCloud.particles, 14)
assert.equal(recolored.fluidCloud.speed, 1.6)
assert.equal(settingsSchema.safeParse({ ...defaultSettings, fluidCloud: { ...defaultSettings.fluidCloud, strands: 9 } }).success, false)
assert.equal(settingsSchema.safeParse({ ...defaultSettings, fluidCloud: { ...defaultSettings.fluidCloud, heightScale: 1.61 } }).success, false)
assert.equal(defaultSettings.fluidCloud.widthScale, 1)
assert.equal(defaultSettings.fluidCloud.heightScale, 1)
assert.equal(defaultSettings.fluidCloud.depth, 1)
assert.equal(defaultSettings.fluidCloud.curvature, 0.55)
assert.equal(defaultSettings.fluidCloud.symmetry, 1)
assert.equal(Math.round(560 * resized.fluidCloud.widthScale), 580)
assert.equal(Math.round(86 * resized.fluidCloud.heightScale), 86)

const creation = {
  id: '93269f91-39ea-4bec-a990-49f563ce6f3d',
  name: '我的流云',
  cloud: { ...defaultSettings.fluidCloud, shape: 'cherry-bloom' as const }
}
const withCreation = applySettingsPatch(defaultSettings, { fluidCloudCreations: [creation] })
assert.equal(withCreation.fluidCloudCreations[0]?.name, '我的流云')
assert.equal(withCreation.fluidCloudCreations[0]?.cloud.shape, 'cherry-bloom')
assert.equal(settingsSchema.safeParse({
  ...defaultSettings,
  fluidCloudCreations: Array.from({ length: 33 }, () => creation)
}).success, false)
assert.equal(settingsSchema.safeParse({
  ...defaultSettings,
  fluidCloudCreations: [{ ...creation, name: '超'.repeat(25) }]
}).success, false)
assert.equal(settingsSchema.safeParse({
  ...defaultSettings,
  fluidCloudCreations: [{ ...creation, id: 'invalid-id' }]
}).success, false)

console.log('settings self-check passed')
