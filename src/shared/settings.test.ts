import assert from 'node:assert/strict'
import { applySettingsPatch, defaultSettings, settingsSchema } from './settings'
import { deriveFluxPalette } from './triggerGesture'

const legacy = settingsSchema.parse({
  theme: 'graphite',
  triggerPosition: 0.2,
  triggerActivationMode: 'guarded-pull',
  triggerWidth: 320,
  notificationPresentation: 'edge-handle'
})
assert.deepEqual(legacy.fluidCloud, defaultSettings.fluidCloud)
assert.deepEqual(legacy.fluidCloudCreations, [])
assert.equal(legacy.showNotificationPreview, true)
assert.equal('triggerPosition' in legacy, false)
assert.equal('notificationPresentation' in legacy, false)
assert.throws(() => applySettingsPatch(defaultSettings, { triggerActivationMode: 'hover' }))

const oldCloud = settingsSchema.parse({
  fluidCloud: {
    shape: 'cherry-bloom',
    color: '#ff4f9a',
    speed: 1.6,
    response: 1.2,
    depth: 1.3,
    curvature: .7,
    strands: 8,
    particles: 14,
    widthScale: 1.2,
    heightScale: .8,
    symmetry: .5
  }
}).fluidCloud
const [, expectedSecondary, expectedTertiary] = deriveFluxPalette('#ff4f9a')
assert.equal(oldCloud.shape, 'cherry-bloom')
assert.equal(oldCloud.secondaryColor, expectedSecondary)
assert.equal(oldCloud.tertiaryColor, expectedTertiary)
assert.equal(oldCloud.noiseScale, 1.2)
assert.equal(oldCloud.speed, 1.6)
assert.equal('strands' in oldCloud, false)
assert.equal('widthScale' in oldCloud, false)

const customized = applySettingsPatch(defaultSettings, {
  fluidCloud: { secondaryColor: '#FF4F9A', noiseScale: 2.4, speed: 1.6 }
})
assert.equal(customized.fluidCloud.secondaryColor, '#FF4F9A')
assert.equal(customized.fluidCloud.noiseScale, 2.4)
assert.equal(customized.fluidCloud.speed, 1.6)
assert.equal(defaultSettings.fluidCloud.color, '#59D6FF')
assert.equal(defaultSettings.fluidCloud.secondaryColor, '#34D399')
assert.equal(defaultSettings.fluidCloud.tertiaryColor, '#8B5CF6')
assert.deepEqual({
  speed: defaultSettings.fluidCloud.speed,
  response: defaultSettings.fluidCloud.response,
  noiseScale: defaultSettings.fluidCloud.noiseScale,
  depth: defaultSettings.fluidCloud.depth,
  curvature: defaultSettings.fluidCloud.curvature
}, { speed: 1, response: 1, noiseScale: 1.2, depth: 1, curvature: .55 })
assert.equal(settingsSchema.safeParse({ ...defaultSettings, fluidCloud: { ...defaultSettings.fluidCloud, noiseScale: 3.01 } }).success, false)
assert.equal(settingsSchema.safeParse({ ...defaultSettings, fluidCloud: { ...defaultSettings.fluidCloud, curvature: 1.01 } }).success, false)

const creation = {
  id: '93269f91-39ea-4bec-a990-49f563ce6f3d',
  name: '我的流云',
  cloud: { ...customized.fluidCloud, shape: 'cherry-bloom' as const }
}
const withCreation = applySettingsPatch(defaultSettings, { fluidCloudCreations: [creation] })
const roundTrip = settingsSchema.parse(JSON.parse(JSON.stringify(withCreation)))
assert.deepEqual(roundTrip.fluidCloudCreations[0], creation)
assert.equal(settingsSchema.safeParse({
  ...defaultSettings,
  fluidCloudCreations: Array.from({ length: 33 }, () => creation)
}).success, false)
assert.equal(settingsSchema.safeParse({
  ...defaultSettings,
  mutedNotificationApps: Array.from({ length: 101 }, (_, index) => ({ id: String(index), name: `应用 ${index}` }))
}).success, false)

console.log('settings self-check passed')
