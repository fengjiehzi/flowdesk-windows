import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const image = {
  isEmpty: () => false,
  resize: () => image,
  toPNG: () => Buffer.from('icon'),
  toDataURL: () => 'data:image/png;base64,aWNvbg=='
}
const electron = {
  app: { getFileIcon: async () => image },
  dialog: { showOpenDialog: async (_options?: unknown) => ({ canceled: false, filePaths: [process.execPath] }) },
  nativeImage: { createFromPath: () => image, createFromBuffer: () => image },
  net: { fetch: async () => ({ ok: false }) },
  shell: {
    openPath: async (_target: string) => '',
    openExternal: async (_target: string) => {},
    readShortcutLink: (_shortcutPath: string) => ({ target: process.execPath, args: '', icon: '' })
  }
}
mock.module('electron', { defaultExport: electron, namedExports: electron })
mock.module('electron-store', { defaultExport: class Store {} })
let discoveryResult: unknown[] | null = null
mock.module('node:child_process', {
  namedExports: {
    execFile: (...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, result?: { stdout: string }) => void
      if (discoveryResult) callback(null, { stdout: JSON.stringify(discoveryResult) })
      else callback(new Error('Unexpected PowerShell shortcut resolution'))
    }
  }
})
const { LauncherController } = await import('./launcher')

test('local launch registration keeps legacy pins and persists files, scripts and directories without executing them', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'island-local-launch-'))
  const script = path.join(directory, '测试 & tools.cmd')
  const document = path.join(directory, '使用说明.txt')
  writeFileSync(script, '@echo test')
  writeFileSync(document, 'test document')
  const open = mock.method(electron.shell, 'openPath')
  try {
    const { controller, store } = createController()
    await controller.addLocalPaths([directory, script, document, process.execPath, script])
    assert.equal(controller.getState().entries.length, 1)
    assert.deepEqual(controller.getState().localEntries.map(item => item.kind), ['folder', 'script', 'file', 'app'])
    assert.equal(open.mock.callCount(), 0, 'Registration must not execute files')
    const restored = new LauncherController(store as never, () => {})
    assert.deepEqual(restored.getState(), controller.getState())
    await restored.addLocalPaths([`"${script}"`, script.toUpperCase()])
    assert.equal(restored.getState().localEntries.length, 4)
  } finally { open.mock.restore(); rmSync(directory, { recursive: true, force: true }) }
})

test('local launch collection is independent from eight pinned entries and invalid paths do not partially save', async () => {
  const { controller } = createController(Array.from({ length: 8 }, () => entry()))
  const directory = mkdtempSync(path.join(tmpdir(), 'island-local-capacity-'))
  try {
    const files = Array.from({ length: 9 }, (_, index) => path.join(directory, `文件${index}.txt`))
    files.forEach(file => writeFileSync(file, 'test'))
    await controller.addLocalPaths(files)
    assert.equal(controller.getState().localEntries.length, 9)
    assert.throws(() => controller.pinLocalEntry(controller.getState().localEntries[0].id, true), /最多/)
    const before = controller.getState()
    await assert.rejects(controller.addLocalPaths([directory, path.join(directory, 'missing')]), /不存在/)
    assert.deepEqual(controller.getState(), before)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('local launch search, recent usage, rename and removal update immediately', async () => {
  const { controller } = createController([])
  await controller.addLocalPaths([process.execPath])
  const item = controller.getState().localEntries[0]
  assert.ok(controller.searchEntries(item.name).some(result => result.id === item.id))
  controller.pinLocalEntry(item.id, true)
  controller.renameEntry({ id: item.id, name: '绿色工具' })
  assert.equal(controller.searchEntries('绿色工具').length, 1, 'Pinned and local results should be deduplicated')
  await controller.launchSearchItem({ source: 'local', id: item.id })
  assert.equal(controller.getState().recentEntries[0].name, '绿色工具')
  controller.removeLocalEntry(item.id)
  assert.equal(controller.getState().localEntries.length, 0)
  assert.equal(controller.getState().entries.length, 0)
  assert.equal(controller.getState().recentEntries.length, 0)
})

test('failed local launch does not create a recent item and unknown IDs cannot launch arbitrary paths', async () => {
  const { controller } = createController([])
  await controller.addLocalPaths([process.execPath])
  const open = mock.method(electron.shell, 'openPath', async () => '无法打开文件')
  try {
    await assert.rejects(controller.launchSearchItem({ source: 'local', id: controller.getState().localEntries[0].id }), /无法打开/)
    assert.equal(controller.getState().recentEntries.length, 0)
    await assert.rejects(controller.launchSearchItem({ source: 'local', id: process.execPath }), /不存在/)
  } finally { open.mock.restore() }
})

test('concurrent local registrations deduplicate against the latest saved state', async () => {
  const { controller } = createController()
  const releases: Array<() => void> = []
  const icons = mock.method(electron.app, 'getFileIcon', () => new Promise<typeof image>(resolve => releases.push(() => resolve(image))))
  try {
    const first = controller.addLocalPaths([process.execPath])
    const second = controller.addLocalPaths([process.execPath])
    const id = controller.getState().entries[0].id
    controller.renameEntry({ id, name: '保留并发修改' })
    releases.forEach(release => release())
    await Promise.all([first, second])
    assert.equal(controller.getState().localEntries.length, 1)
    assert.equal(controller.getState().entries[0].name, '保留并发修改')
  } finally { icons.mock.restore() }
})

test('local launch reports history save failure without falsely reporting that opening failed', async () => {
  const { controller, store } = createController([])
  await controller.addLocalPaths([process.execPath])
  const before = controller.getState()
  Object.defineProperty(store, 'store', { set: () => { throw new Error('disk full') } })
  const result = await controller.launchSearchItem({ source: 'local', id: before.localEntries[0].id })
  assert.equal(result.recentSaved, false)
  assert.deepEqual(controller.getState(), before)
})

test('local launch file and folder pickers use the requested mode and cancellation does not save', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'island-local-picker-'))
  const file = path.join(directory, '脚本.cmd')
  writeFileSync(file, '@echo test')
  const { controller } = createController([])
  const picker = mock.method(electron.dialog, 'showOpenDialog', async () => ({ canceled: false, filePaths: [file] }))
  try {
    await controller.pickLocalTargets('files')
    assert.deepEqual((picker.mock.calls[0].arguments[0] as { properties: string[] }).properties, ['openFile', 'multiSelections'])
    picker.mock.mockImplementation(async () => ({ canceled: false, filePaths: [directory] }))
    await controller.pickLocalTargets('folder')
    assert.equal(controller.getState().localEntries.at(-1)?.kind, 'folder')
    assert.deepEqual((picker.mock.calls[1].arguments[0] as { properties: string[] }).properties, ['openDirectory'])
    const before = controller.getState()
    picker.mock.mockImplementation(async () => ({ canceled: true, filePaths: [] }))
    assert.equal(await controller.pickLocalTargets('files'), null)
    assert.deepEqual(controller.getState(), before)
  } finally { picker.mock.restore(); rmSync(directory, { recursive: true, force: true }) }
})

test('launcher recovery keeps valid entries and backs up an invalid neighbour', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'island-launcher-test-'))
  try {
    const original = { setupCompleted: true, entries: [entry(), { ...entry(), name: '' }] }
    const file = path.join(directory, 'launcher.json')
    const bytes = JSON.stringify(original)
    writeFileSync(file, bytes)
    const controller = new LauncherController({ path: file, store: original } as never, () => {})
    assert.equal(controller.getState().entries.length, 1)
    assert.equal(controller.getState().entries[0].id, original.entries[0].id)
    assert.equal(readFileSync(controller.recoveryBackupPath!, 'utf8'), bytes)
  } finally { rmSync(directory, { recursive: true }) }
})

test('undo deletion restores the exact target and original position', () => {
  const original = [entry(0), entry(1), entry(2)]
  const { controller, store } = createController(original)
  controller.removeEntry(original[1].id)
  controller.restoreRemovedEntry()
  assert.deepEqual(store.store.entries, original)
  assert.throws(() => controller.restoreRemovedEntry(), /没有可撤销/)
})

test('undo deletion respects capacity and remains retryable after a failed write', () => {
  const original = Array.from({ length: 8 }, (_, index) => entry(index))
  const { controller, store } = createController(original)
  controller.removeEntry(original[0].id)
  const removed = controller as unknown as { data: { entries: typeof original } }
  removed.data.entries.push(entry(9))
  assert.throws(() => controller.restoreRemovedEntry(), /最多添加/)
  removed.data.entries.pop()
  let stored = store.store
  Object.defineProperty(store, 'store', { configurable: true, get: () => stored, set: () => { throw new Error('disk full') } })
  assert.throws(() => controller.restoreRemovedEntry(), /disk full/)
  Object.defineProperty(store, 'store', { get: () => stored, set: (value) => { stored = value } })
  controller.restoreRemovedEntry()
  assert.deepEqual(stored.entries, original)
})

const entry = (index = 0) => ({
  id: randomUUID(), kind: 'website' as const, name: `网站${index}`,
  launchType: 'url' as const, target: `https://existing${index}.example/`
})
function createController(entries = [entry()]) {
  const store = { store: { setupCompleted: true, entries } }
  const controller = new LauncherController(store as never, () => {})
  return { controller, store }
}
function deferIcons() {
  const releases: Array<() => void> = []
  electron.net.fetch = () => new Promise((resolve) => releases.push(() => resolve({ ok: false })))
  return releases
}

test('application discovery accepts AppsFolder apps and shell icons without a filesystem target', async () => {
  discoveryResult = [
    { name: 'ChatGPT', launchType: 'appId', target: 'OpenAI.Codex_2p2nqsd0c76g0!App', icon: 'data:image/png;base64,aWNvbg==' },
    { name: 'Gemini', launchType: 'path', target: process.execPath, icon: 'data:image/png;base64,aWNvbg==' }
  ]
  try {
    const { controller } = createController([])
    const apps = await controller.discoverInstalledApps(true)
    assert.deepEqual(apps.map((item) => item.name).sort(), ['ChatGPT', 'Gemini'])
    assert.ok(apps.every((item) => item.icon))
    controller.addInstalledApps(apps.map((item) => item.id))
    assert.equal(controller.getState().entries.length, 2)
  } finally { discoveryResult = null }
})

test('refreshing application discovery repairs an existing shortcut icon without changing its name', async () => {
  const oldEntry = { id: randomUUID(), kind: 'app', name: '我的应用名称', launchType: 'path', target: process.execPath }
  const icon = 'data:image/png;base64,aWNvbg=='
  discoveryResult = [{ name: '原始应用名称', launchType: 'path', target: process.execPath, icon }]
  try {
    const { controller } = createController([oldEntry] as never)
    await controller.discoverInstalledApps(true)
    assert.equal(controller.getState().entries[0].name, oldEntry.name)
    assert.equal(controller.getState().entries[0].icon, icon)
  } finally { discoveryResult = null }
})

test('manual .lnk selection uses native shortcut details, including paths with spaces', async () => {
  const shortcutPath = path.join(path.dirname(process.execPath), 'Demo Folder', "app's shortcut.lnk")
  const read = mock.method(electron.shell, 'readShortcutLink')
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [shortcutPath] })
  const { controller } = createController([])
  const result = await controller.pickLocalApplication()
  assert.equal(result?.entries.length, 1)
  assert.equal(read.mock.calls[0]?.arguments[0], shortcutPath)
  read.mock.restore()
})

test('a pending website addition preserves a concurrent rename', async () => {
  const releases = deferIcons()
  const { controller } = createController()
  const id = controller.getState().entries[0].id
  const pending = controller.addWebsite({ name: '新网站', url: 'https://new.example' })
  controller.renameEntry({ id, name: '修改后的名称' })
  releases[0]()
  const result = await pending
  assert.equal(result.entries.find((item) => item.id === id)?.name, '修改后的名称')
})

test('concurrent website additions preserve both entries', async () => {
  const releases = deferIcons()
  const { controller } = createController([])
  const first = controller.addWebsite({ name: 'A', url: 'https://a.example' })
  const second = controller.addWebsite({ name: 'B', url: 'https://b.example' })
  releases.forEach((release) => release())
  await Promise.all([first, second])
  assert.deepEqual(controller.getState().entries.map((item) => item.name), ['A', 'B'])
})

test('capacity is rechecked after icon retrieval', async () => {
  const releases = deferIcons()
  const { controller } = createController(Array.from({ length: 7 }, (_, index) => entry(index)))
  const first = controller.addWebsite({ name: 'A', url: 'https://a.example' })
  const second = controller.addWebsite({ name: 'B', url: 'https://b.example' })
  releases.forEach((release) => release())
  const results = await Promise.allSettled([first, second])
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected'])
  assert.equal(controller.getState().entries.length, 8)
})

test('duplicate websites are rejected after concurrent icon retrieval', async () => {
  const releases = deferIcons()
  const { controller } = createController([])
  const first = controller.addWebsite({ name: 'A', url: 'https://same.example' })
  const second = controller.addWebsite({ name: 'B', url: 'https://same.example' })
  releases.forEach((release) => release())
  const results = await Promise.allSettled([first, second])
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected'])
  assert.equal(controller.getState().entries.length, 1)
})

test('a pending local application addition preserves a concurrent removal', async () => {
  let release!: () => void
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.execPath] })
  electron.app.getFileIcon = () => new Promise((resolve) => { release = () => resolve(image) })
  const { controller } = createController()
  const id = controller.getState().entries[0].id
  const pending = controller.pickLocalApplication()
  await new Promise((resolve) => setImmediate(resolve))
  controller.removeEntry(id)
  release()
  const result = await pending
  assert.equal(result?.entries.length, 1)
  assert.equal(result?.entries.some((item) => item.id === id), false)
})

test('a failed disk write leaves the in-memory launcher state unchanged', () => {
  const { controller, store } = createController()
  const before = controller.getState()
  Object.defineProperty(store, 'store', { set: () => { throw new Error('disk full') } })
  assert.throws(() => controller.renameEntry({ id: before.entries[0].id, name: '未保存名称' }), /disk full/)
  assert.deepEqual(controller.getState(), before)
})

test('oversized icons without Content-Length stop streaming at the byte limit', async () => {
  let chunks = 0
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(160_000))
      if (++chunks === 5) controller.close()
    },
    cancel() { canceled = true }
  })
  electron.net.fetch = async () => new Response(body)
  const { controller } = createController([])
  const result = await controller.addWebsite({ name: '大图标', url: 'https://large.example' })
  assert.equal(canceled, true)
  assert.ok(chunks < 5)
  assert.equal(result.entries[0].icon, undefined)
})

test('a valid streamed icon is still saved', async () => {
  electron.net.fetch = async () => new Response(Buffer.from('icon'))
  const { controller } = createController([])
  const result = await controller.addWebsite({ name: '小图标', url: 'https://small.example' })
  assert.equal(result.entries[0].icon, 'data:image/png;base64,aWNvbg==')
})

test('an icon rejected by Content-Length cancels its response body', async () => {
  let canceled = false
  electron.net.fetch = async () => new Response(new ReadableStream({
    cancel() { canceled = true }
  }), { headers: { 'Content-Length': '300000' } })
  const { controller } = createController([])
  await controller.addWebsite({ name: '超限图标', url: 'https://declared-large.example' })
  assert.equal(canceled, true)
})

for (const method of ['picker', 'discovery'] as const) {
  test(`pinning a registered local app through ${method} preserves its identity and name`, async () => {
    const icons = mock.method(electron.app, 'getFileIcon', async () => image)
    const picker = mock.method(electron.dialog, 'showOpenDialog', async () => ({ canceled: false, filePaths: [process.execPath] }))
    try {
      const { controller } = createController([])
      await controller.addLocalPaths([process.execPath])
      const local = controller.getState().localEntries[0]
      controller.renameEntry({ id: local.id, name: '我的本地应用' })
      if (method === 'picker') await controller.pickLocalApplication()
      else {
        discoveryResult = [{ name: '扫描名称', launchType: 'path', target: process.execPath }]
        const candidates = await controller.discoverInstalledApps(true)
        controller.addInstalledApps(candidates.map(item => item.id))
      }
      assert.equal(controller.getState().entries[0].id, local.id)
      assert.equal(controller.getState().entries[0].name, '我的本地应用')
      controller.renameEntry({ id: local.id, name: '同步改名' })
      assert.equal(controller.getState().entries[0].name, '同步改名')
      controller.pinLocalEntry(local.id, false)
      assert.equal(controller.getState().entries.length, 0)
    } finally { discoveryResult = null; icons.mock.restore(); picker.mock.restore() }
  })
}

test('loading legacy duplicate local and pinned records reconciles their identity and history', () => {
  const pinned = { id: randomUUID(), kind: 'app' as const, name: '固定名称', launchType: 'path' as const, target: process.execPath }
  const local = { ...pinned, id: randomUUID(), name: '旧本地名称' }
  const store = { store: { setupCompleted: true, entries: [pinned], localEntries: [local], recentEntries: [local] } }
  const controller = new LauncherController(store as never, () => {})
  assert.equal(controller.getState().localEntries[0].id, pinned.id)
  assert.equal(controller.getState().localEntries[0].name, pinned.name)
  assert.equal(controller.getState().recentEntries[0].id, pinned.id)
  controller.renameEntry({ id: pinned.id, name: '统一名称' })
  assert.ok(controller.getState().recentEntries.every(item => item.name === '统一名称'))
  assert.equal(new LauncherController(store as never, () => {}).getState().localEntries[0].id, pinned.id)
})

test('a pending local registration reuses an app pinned while its icon is loading', async () => {
  let release!: () => void
  const icons = mock.method(electron.app, 'getFileIcon', () => new Promise<typeof image>(resolve => { release = () => resolve(image) }))
  try {
    const { controller } = createController([])
    const pending = controller.addLocalPaths([process.execPath])
    discoveryResult = [{ name: '并发固定', launchType: 'path', target: process.execPath, icon: 'data:image/png;base64,aWNvbg==' }]
    const candidates = await controller.discoverInstalledApps(true)
    controller.addInstalledApps(candidates.map(item => item.id))
    release()
    await pending
    assert.equal(controller.getState().localEntries[0].id, controller.getState().entries[0].id)
    assert.equal(controller.getState().localEntries[0].name, '并发固定')
  } finally { discoveryResult = null; icons.mock.restore() }
})

test('case-sensitive website paths and query values stay distinct in search history and undo', async () => {
  const fetch = mock.method(electron.net, 'fetch', async () => ({ ok: false }))
  try {
    const { controller } = createController([])
    await controller.addWebsite({ name: 'Upper', url: 'https://example.com/Report?token=AbC' })
    await controller.addWebsite({ name: 'Lower', url: 'https://example.com/report?token=abc' })
    const entries = controller.getState().entries
    assert.equal(controller.searchEntries('').length, 2)
    for (const entry of entries) await controller.launchEntry(entry.id)
    assert.equal(controller.getState().recentEntries.length, 2)
    controller.removeEntry(entries[0].id)
    controller.restoreRemovedEntry()
    assert.equal(controller.getState().entries.length, 2)
  } finally { fetch.mock.restore() }
})
