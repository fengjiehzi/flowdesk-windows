import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applySettingsPatch, defaultSettings, type IslandSettingsPatch } from '../../shared/settings'
import { SettingsPersistence } from './settingsPersistence'
import type { SettingsUpdateResult } from '../../shared/types'

test('serial persistence retains newer edits over old broadcasts and flush waits for the last edit', async () => {
  const sent: IslandSettingsPatch[] = []
  const replies: Array<(settings: SettingsUpdateResult) => void> = []
  const queue = new SettingsPersistence(defaultSettings, (patch) => {
    sent.push(patch)
    return new Promise((resolve) => replies.push(resolve))
  }, () => {})
  void queue.enqueue({ hideDelayMs: 1200 })
  await Promise.resolve()
  void queue.enqueue({ hideDelayMs: 1600, opacity: .8 })
  queue.receive(defaultSettings, 0)
  assert.equal(queue.value().hideDelayMs, 1600)
  const flushed = queue.flush()
  replies[0]({ settings: applySettingsPatch(defaultSettings, sent[0]), settingsRevision: 1 })
  await Promise.resolve()
  assert.equal(sent.length, 2)
  assert.equal(sent[1].hideDelayMs, 1600)
  replies[1]({ settings: applySettingsPatch(defaultSettings, sent[1]), settingsRevision: 2 })
  assert.equal(await flushed, true)
  assert.equal(queue.value().opacity, .8)
  assert.equal(queue.status, 'saved')
})

test('failed writes retain the patch for explicit retry and return false to close protection', async () => {
  let fails = true
  const queue = new SettingsPersistence(defaultSettings, async (patch) => {
    if (fails) throw new Error('disk full')
    return { settings: applySettingsPatch(defaultSettings, patch), settingsRevision: 1 }
  }, () => {})
  assert.equal(await queue.enqueue({ position: 'right' }), false)
  assert.equal(queue.status, 'error')
  assert.equal(queue.value().position, 'right')
  fails = false
  assert.equal(await queue.flush(), true)
  assert.equal(queue.status, 'saved')
  assert.equal(queue.value().position, 'right')
})

test('revision ordering rejects an old initial snapshot after a newer window broadcast', () => {
  const queue = new SettingsPersistence(defaultSettings, async () => ({ settings: defaultSettings, settingsRevision: 0 }), () => {})
  queue.receive({ ...defaultSettings, theme: 'aurora' }, 2)
  queue.receive(defaultSettings, 1)
  assert.equal(queue.value().theme, 'aurora')
})

test('an earlier save response cannot erase a more recent change from another window', async () => {
  let reply!: (settings: SettingsUpdateResult) => void
  const queue = new SettingsPersistence(defaultSettings, () => new Promise((resolve) => { reply = resolve }), () => {})
  const pending = queue.enqueue({ hideDelayMs: 1200 })
  await Promise.resolve()
  queue.receive({ ...defaultSettings, hideDelayMs: 1200, theme: 'aurora' }, 2)
  reply({ settings: { ...defaultSettings, hideDelayMs: 1200 }, settingsRevision: 1 })
  await pending
  assert.equal(queue.value().theme, 'aurora')
})

test('a clock broadcast before persistence cannot undo an acknowledged field', async () => {
  let reply!: (settings: SettingsUpdateResult) => void
  const queue = new SettingsPersistence(defaultSettings, () => new Promise((resolve) => { reply = resolve }), () => {})
  const pending = queue.enqueue({ theme: 'aurora' })
  await Promise.resolve()
  queue.receive(defaultSettings, 0)
  reply({ settings: { ...defaultSettings, theme: 'aurora' }, settingsRevision: 1 })
  assert.equal(await pending, true)
  assert.equal(queue.value().theme, 'aurora')
})
