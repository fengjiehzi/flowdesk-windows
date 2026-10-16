import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { defaultSettings, recoverSettings, settingsSchema } from '../shared/settings'
import { loadRecoverableConfig } from './configRecovery'

test('recovery preserves valid fields and creation values while backing up exact original bytes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'island-config-test-'))
  try {
    const original = {
      ...defaultSettings, theme: 'aurora', hideDelayMs: -1,
      fluidCloud: { ...defaultSettings.fluidCloud, speed: 99, depth: 1.3 },
      fluidCloudCreations: [
        { id: '93269f91-39ea-4bec-a990-49f563ce6f3d', name: '保留方案', cloud: { ...defaultSettings.fluidCloud, speed: 99, depth: 1.2 } },
        { id: 'invalid', name: '异常方案', cloud: {} }
      ]
    }
    const originalBytes = `${JSON.stringify(original, null, 2)}\n`
    const file = path.join(directory, 'settings.json')
    writeFileSync(file, originalBytes)
    const store = { path: file, store: original as never }
    const loaded = loadRecoverableConfig(store, settingsSchema, recoverSettings)
    assert.ok(loaded.backupPath)
    assert.equal(readFileSync(loaded.backupPath, 'utf8'), originalBytes)
    assert.equal(loaded.data.theme, 'aurora')
    assert.equal(loaded.data.hideDelayMs, defaultSettings.hideDelayMs)
    assert.equal(loaded.data.fluidCloud.depth, 1.3)
    assert.equal(loaded.data.fluidCloud.speed, 1)
    assert.equal(loaded.data.fluidCloudCreations.length, 1)
    assert.equal(loaded.data.fluidCloudCreations[0].cloud.depth, 1.2)
  } finally { rmSync(directory, { recursive: true }) }
})

test('backup failure never writes repaired data over the original store', () => {
  const original = { ...defaultSettings, hideDelayMs: -1 }
  let writes = 0
  const store = {
    path: path.join(tmpdir(), 'missing-island-directory', 'settings.json'),
    get store() { return original },
    set store(_value) { writes++ }
  }
  assert.throws(() => loadRecoverableConfig(store, settingsSchema, recoverSettings))
  assert.equal(writes, 0)
  assert.equal(store.store, original)
})

test('valid settings load without changing the store or creating a backup', () => {
  let writes = 0
  const store = { path: '', get store() { return defaultSettings }, set store(_value) { writes++ } }
  assert.equal(loadRecoverableConfig(store, settingsSchema, recoverSettings).backupPath, null)
  assert.equal(writes, 0)
})
