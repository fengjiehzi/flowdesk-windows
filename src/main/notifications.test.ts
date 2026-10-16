import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mock, test } from 'node:test'
import { defaultSettings } from '../shared/settings'
import type { BridgeNotification } from '../shared/notifications'

function createChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: mock.fn(() => true)
  })
}
const children: ReturnType<typeof createChild>[] = []
mock.module('node:child_process', {
  namedExports: { spawn: () => { const child = createChild(); children.push(child); return child } }
})
const { NotificationController } = await import('./notifications')

function setup() {
  children.length = 0
  const settings = { ...defaultSettings, notificationsEnabled: true }
  let previews = 0
  const controller = new NotificationController({
    bridgePath: process.execPath, clipboardArchivePath: () => 'C:\\Archive',
    settings: () => settings, onState: () => {}, onNotification: () => { previews++ }
  })
  controller.configure()
  const emit = (event: unknown) => children.at(-1)!.stdout.emit('data', `${JSON.stringify(event)}\n`)
  return { settings, controller, emit, previews: () => previews }
}
const notification = (platformId: number): BridgeNotification => ({
  platformId, appId: 'test.chat', appName: '测试聊天', title: '测试消息', body: '测试内容',
  createdAt: new Date().toISOString()
})

test('clipboard configuration preserves Chinese paths over a Windows native pipe', () => {
  children.length = 0
  const archivePath = 'C:\\Users\\测试用户\\Documents\\Windows灵动岛\\剪贴板记录'
  const controller = new NotificationController({
    bridgePath: process.execPath, clipboardArchivePath: () => archivePath,
    settings: () => ({ ...defaultSettings, clipboardArchiveEnabled: true }), onState: () => {}, onNotification: () => {}
  })
  controller.configure()
  const commands = children[0].stdin.read().toString()
  assert.match(commands, /^[\x00-\x7f]*$/)
  const configure = commands.trim().split('\n').map((line: string) => JSON.parse(line)).find((command: { type: string }) => command.type === 'configure')
  assert.equal(configure.clipboardArchivePath, archivePath)
  assert.equal(configure.clipboardArchiveEnabled, true)
})

test('clipboard listening state requires a native acknowledgement and clears when disabled', () => {
  const { controller, settings, emit } = setup()
  settings.clipboardArchiveEnabled = true
  controller.configure()
  assert.equal(controller.getState().clipboardArchiveActive, false)
  emit({ type: 'clipboardArchiveStatus', enabled: true })
  assert.equal(controller.getState().clipboardArchiveActive, true)
  settings.clipboardArchiveEnabled = false
  controller.configure()
  assert.equal(controller.getState().clipboardArchiveActive, false)
})

test('late snapshots and desktop events are ignored after notifications are disabled', () => {
  const { controller, settings, emit, previews } = setup()
  emit({ type: 'snapshot', notifications: [] })
  settings.notificationsEnabled = false
  settings.clipboardArchiveEnabled = true
  controller.configure()
  emit({ type: 'snapshot', notifications: [notification(1)] })
  emit({ type: 'desktopNotification', notification: notification(2) })
  assert.equal(controller.getState().items.length, 0)
  assert.equal(controller.getState().sources.length, 0)
  assert.equal(previews(), 0)
})

test('a queued bridge restart does not run after shutdown', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller } = setup()
  children[0].emit('close')
  await controller.shutdown()
  context.mock.timers.tick(1000)
  assert.equal(children.length, 1)
})

test('a queued bridge restart does not run after both services are disabled', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller, settings } = setup()
  children[0].emit('close')
  settings.notificationsEnabled = false
  controller.configure()
  context.mock.timers.tick(1000)
  assert.equal(children.length, 1)
})

test('enabled notifications still arrive and a needed bridge still restarts', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller, emit, previews } = setup()
  emit({ type: 'snapshot', notifications: [] })
  emit({ type: 'snapshot', notifications: [notification(1)] })
  assert.equal(controller.getState().items.length, 1)
  assert.equal(previews(), 1)
  children[0].emit('close')
  context.mock.timers.tick(1000)
  assert.equal(children.length, 2)
})

test('a stalled shutdown can be cancelled without killing the bridge', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller } = setup()
  const pending = controller.shutdown(async () => 'cancel')
  context.mock.timers.tick(10_000)
  assert.equal(await pending, false)
  assert.equal(children[0].kill.mock.callCount(), 0)
  assert.equal(children[0].listenerCount('close'), 1)
  children[0].emit('close')
  context.mock.timers.tick(1000)
  assert.equal(children.length, 2)
})

test('waiting after a stalled shutdown still completes on bridge close', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller } = setup()
  let prompts = 0
  const pending = controller.shutdown(async () => { prompts++; return 'wait' })
  context.mock.timers.tick(10_000)
  await Promise.resolve()
  children[0].emit('close')
  assert.equal(await pending, true)
  assert.equal(prompts, 1)
  assert.equal(children[0].kill.mock.callCount(), 0)
})

test('only an explicit force decision kills a stalled bridge', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller } = setup()
  const pending = controller.shutdown(async () => 'force')
  context.mock.timers.tick(10_000)
  assert.equal(await pending, true)
  assert.equal(children[0].kill.mock.callCount(), 1)
})

test('normal bridge close completes shutdown without waiting for a timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller } = setup()
  const pending = controller.shutdown(async () => { throw new Error('Unexpected prompt') })
  children[0].emit('close')
  assert.equal(await pending, true)
})

test('source cache stays bounded while muted sources remain available', () => {
  const { controller, settings, emit } = setup()
  settings.mutedNotificationApps = [{ id: 'muted.old', name: '旧来源' }]
  for (let id = 0; id < 130; id++) emit({ type: 'desktopNotification', notification: { ...notification(id), appId: `app.${id}` } })
  const cache = (controller as unknown as { discoveredSources: Map<string, unknown> }).discoveredSources
  assert.equal(cache.size, 100)
  assert.ok(controller.getState().sources.some((source) => source.id === 'muted.old' && source.muted))
})
