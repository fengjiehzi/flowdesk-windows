import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
import { applySettingsPatch, defaultSettings, type FluidCloudSettings } from '../../shared/settings'
import { launcherNameSchema } from '../../shared/launcher'

// Exercise the actual handlers without starting Electron or mounting the desktop UI.
function sourceFile(relativePath: string) {
  const url = new URL(relativePath, import.meta.url)
  return ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function findFunction(source: ts.SourceFile, name: string) {
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name)
  assert.ok(node?.body, `Missing handler ${name}`)
  return node
}
function javascript(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
}

test('failed settings persistence leaves the main-process settings unchanged', () => {
  const source = sourceFile('../../main/index.ts')
  const handler = findFunction(source, 'updateSettings').getText(source)
  const { run, current } = new Function('applySettingsPatch', 'settings', `${javascript(handler)}
    return { run: updateSettings, current: () => settings }
  `)(applySettingsPatch, defaultSettings)
  const store = { set store(_value: unknown) { throw new Error('disk full') } }
  assert.throws(() => run(store, { hideDelayMs: 1200 }), /disk full/)
  assert.deepEqual(current(), defaultSettings)
})

test('launcher manager receives settings snapshots, excluding clock-only broadcasts', () => {
  const source = sourceFile('../../main/index.ts')
  const handler = findFunction(source, 'broadcastSnapshot').getText(source)
  const sent: unknown[][] = []
  const expected = { settings: defaultSettings }
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: (...args: unknown[]) => sent.push(args) }
  }
  const run = new Function('snapshot', 'surfaces', 'creatorWindow', 'settingsWindow', 'launcherWindow', `${javascript(handler)}return broadcastSnapshot`)(() => expected, [], null, null, window)
  run()
  assert.deepEqual(sent, [['island:snapshot', expected]])
  run(false)
  assert.equal(sent.length, 1)
})

test('hide command dismisses an active notification preview', () => {
  const source = sourceFile('../../main/index.ts')
  const handler = findFunction(source, 'hideIsland').getText(source)
  const cleared: unknown[] = []
  const { run, current } = new Function('clearTimeout', 'transition', `${javascript(handler)}
    let surfaceTimer = 'old'
    let notificationVisible = true
    function clearTransitionTimer() {}
    function hideNotificationPreview() { notificationVisible = false; surfaceTimer = 'preview' }
    return { run: hideIsland, current: () => ({ notificationVisible, surfaceTimer }) }
  `)((timer: unknown) => cleared.push(timer), () => {})
  run()
  assert.deepEqual(current(), { notificationVisible: false, surfaceTimer: 'preview' })
  assert.deepEqual(cleared, ['old'])
})

test('desktop startup has no demo notifications before the bridge responds', () => {
  const source = sourceFile('./main.tsx')
  const declarations = source.statements.filter(ts.isVariableStatement).flatMap((item) => [...item.declarationList.declarations])
  const initial = declarations.find((item) => item.name.getText(source) === 'previewNotificationState')?.initializer
  assert.ok(initial, 'Missing initial notification state')
  const read = new Function('window', javascript(`return (${initial.getText(source)})`))
  const desktop = read({ island: {} })
  assert.equal(desktop.unreadCount, 0)
  assert.deepEqual(desktop.items, [])
  assert.deepEqual(desktop.sources, [])
  assert.ok(desktop.desktopAdapters.every((item: { status: string }) => item.status === 'disabled'))
  const preview = read({})
  assert.equal(preview.unreadCount, 2)
  assert.equal(preview.items.length, 1)
})

test('saving a creation records the submitted cloud when editing continues during persistence', async () => {
  const source = sourceFile('./main.tsx')
  const studio = findFunction(source, 'CloudStudio')
  const declarations = studio.body!.statements.filter(ts.isVariableStatement).flatMap((item) => [...item.declarationList.declarations])
  const save = declarations.find((item) => item.name.getText(source) === 'saveCreation')?.initializer
  assert.ok(save, 'Missing saveCreation handler')
  const cloudRef = { current: { ...defaultSettings.fluidCloud } }
  const submitted = { ...cloudRef.current }
  let savedCloud: FluidCloudSettings | null = null
  let release!: (saved: boolean) => void
  const context = {
    cloudRef, launcherNameSchema, creationName: '测试方案', activeCreationId: null, creations: [], saving: false, pendingCreationId: { current: null },
    persistCreations: () => new Promise<boolean>((resolve) => { release = resolve }),
    setSaving: () => {}, setActiveCreationId: () => {},
    setSavedCloud: (cloud: FluidCloudSettings) => { savedCloud = cloud }, notify: () => {}
  }
  const run = new Function(...Object.keys(context), javascript(`const handler = ${save.getText(source)}; return handler`))(...Object.values(context))
  const pending = run()
  cloudRef.current = { ...submitted, speed: 1.8 }
  release(true)
  await pending
  assert.deepEqual(savedCloud, submitted)
  assert.notDeepEqual(savedCloud, cloudRef.current)
})

test('native editor close waits for the renderer and respects a cancelled save or discard', async () => {
  const source = sourceFile('../../main/index.ts')
  const handlers = ['prepareWindowClose', 'protectWindowClose'].map((name) => findFunction(source, name).getText(source)).join('\n')
  const requests = new Map<number, { id: number; finish: (ready: boolean) => void }>()
  const sent: unknown[][] = []
  let closed = 0
  let prevented = 0
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { id: 1, send: (...args: unknown[]) => sent.push(args) },
    close: () => { closed++ }
  })
  const protect = new Function('closeRequests', 'approvedCloses', `${javascript(handlers)}
    let closeRequestId = 0
    let quitReady = false
    return protectWindowClose
  `)(requests, new WeakSet())
  protect(window)
  const event = { preventDefault: () => { prevented++ } }
  window.emit('close', event)
  assert.equal(closed, 0)
  assert.equal(prevented, 1)
  assert.equal(sent[0][0], 'island:prepareClose')
  requests.get(1)!.finish(false)
  await Promise.resolve()
  assert.equal(closed, 0)
  window.emit('close', event)
  requests.get(1)!.finish(true)
  await Promise.resolve()
  assert.equal(closed, 1)
  assert.equal(requests.size, 0)
})
