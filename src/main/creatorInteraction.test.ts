import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import ts from 'typescript'
import { surfaceWindowMode } from '../shared/islandPresentation'

function handler(name: string) {
  const text = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const source = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true)
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name)
  assert.ok(node, `Missing ${name}`)
  return ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
}

test('launcher panel dimensions fit the active display work area', () => {
  const fixedSurfaceWindows = { panel: { width: 808, height: 488, inset: 12, contentWidth: 784, contentHeight: 464 } }
  const displays = [{ id: 1, workArea: { width: 1920, height: 1040 } }, { id: 2, workArea: { width: 640, height: 480 } }]
  for (const activeDisplayId of [1, 2]) {
    const context = { screen: { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0] }, fixedSurfaceWindows, activeDisplayId, visibleTopOffset: 12 }
    const dimensions = new Function(...Object.keys(context), `${handler('surfaceDimensions')}return surfaceDimensions`)(...Object.values(context))('panel')
    const area = displays.find(display => display.id === activeDisplayId)!.workArea
    assert.ok(dimensions.width <= area.width)
    assert.ok(dimensions.height + 12 <= area.height)
    assert.equal(dimensions.contentWidth, dimensions.width - 24)
    assert.equal(dimensions.contentHeight, dimensions.height - 24)
  }
})

for (const name of ['Launcher', 'Creator', 'Settings']) {
  for (const reuse of [false, true]) {
    test(`${name} tool hides the island before ${reuse ? 'reusing' : 'opening'} its window`, async () => {
      const calls: string[] = []
      class Window extends EventEmitter {
        webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send() {} })
        isDestroyed() { return false }
        isVisible() { return true }
        show() { calls.push('show') }
        focus() { calls.push('focus') }
        async loadFile() { calls.push('load') }
        async loadURL() { calls.push('load') }
      }
      const initial = reuse ? new Window() : null
      let state = 'EXPANDED'
      const context = {
        BrowserWindow: Window, hideIsland: () => { calls.push('hide'); state = 'HIDDEN' },
        hideNotificationPreview() {}, secureWindow() {}, protectWindowClose() {}, bindCreatorWindowInteraction() {},
        launcherWindow: name === 'Launcher' ? initial : null, creatorWindow: name === 'Creator' ? initial : null,
        settingsWindow: name === 'Settings' ? initial : null, nativeImage: { createFromPath() {} },
        iconPath: '', preloadPath: '', currentDir: '', path: { join: (...parts: string[]) => parts.join('/') },
        process: { env: {} }, launcherController: null, notificationController: null, snapshot: () => ({})
      }
      const open = new Function(...Object.keys(context), `${handler(`open${name}Window`)}return open${name}Window`)(...Object.values(context))
      await open()
      assert.equal(state, 'HIDDEN')
      assert.equal(calls[0], 'hide')
      assert.ok(calls.includes(reuse ? 'focus' : 'load'))
    })
  }
}

test('creator native move hooks emit once per phase and ignore callbacks after close', () => {
  const messages = new Map<number, () => void>()
  const sent: unknown[][] = []
  const window = Object.assign(new EventEmitter(), {
    webContents: { isDestroyed: () => false, send: (...args: unknown[]) => sent.push(args) },
    hookWindowMessage: (id: number, callback: () => void) => messages.set(id, callback),
    unhookWindowMessage: (id: number) => messages.delete(id)
  })
  const bind = new Function('process', `${handler('bindCreatorWindowInteraction')}return bindCreatorWindowInteraction`)({ platform: 'win32' })
  bind(window)
  messages.get(0x0231)!()
  messages.get(0x0231)!()
  messages.get(0x0232)!()
  assert.deepEqual(sent, [['creator:windowInteraction', true], ['creator:windowInteraction', false]])
  window.emit('closed')
  messages.get(0x0231)!()
  assert.equal(sent.length, 2)
})

for (const state of ['HIDDEN', 'COMPACT', 'EXPANDED'] as const) {
  test(`surface mouse handling never forwards input during ${state}`, () => {
    class Surface {
      mouse: { ignore: boolean; forward?: boolean }[] = []
      visible = true
      isVisible() { return this.visible }
      showInactive() { this.visible = true }
      hide() { this.visible = false }
      setFocusable() {}
      moveTop() {}
      setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }) { this.mouse.push({ ignore, forward: options?.forward }) }
    }
    const windows = { compact: new Surface(), panel: new Surface() }
    let delayed!: () => void
    const context = {
      surfaces: ['compact', 'panel'], validWindow: (surface: keyof typeof windows) => windows[surface],
      state, notificationVisible: false, surfaceWindowMode, positionWindows() {}, broadcastSnapshot() {},
      syncSequence: 0, surfaceTimer: null, transitionMs: 180, clearTimeout() {},
      setTimeout: (callback: () => void) => { delayed = callback; return 1 }
    }
    const sync = new Function(...Object.keys(context), `${handler('syncSurfaceWindows')}return syncSurfaceWindows`)(...Object.values(context))
    sync()
    delayed()
    for (const surface of ['compact', 'panel'] as const) {
      const calls = windows[surface].mouse
      assert.ok(calls.length)
      assert.ok(calls.every(call => call.forward !== true), 'Native mouse forwarding can corrupt another window drag, including while hidden')
      assert.equal(calls.at(-1)!.ignore, surfaceWindowMode(surface, state, false) === 'hidden')
    }
  })
}

test('surface mouse handling starts without a forwarding hook', async () => {
  let created!: Surface
  class Surface extends EventEmitter {
    mouse: { ignore: boolean; forward?: boolean }[] = []
    constructor() { super(); created = this }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }) { this.mouse.push({ ignore, forward: options?.forward }) }
    async loadFile() {}
  }
  const context = {
    BrowserWindow: Surface, surfaceDimensions: () => ({ width: 504, height: 306 }),
    nativeImage: { createFromPath() {} }, iconPath: '', preloadPath: '', currentDir: '',
    windows: { compact: null, panel: null }, secureWindow() {}, cleanupTimers() {},
    path: { join: (...parts: string[]) => parts.join('/') }, process: { env: {} }
  }
  const create = new Function(...Object.keys(context), `${handler('createSurfaceWindow')}return createSurfaceWindow`)(...Object.values(context))
  await create('panel')
  assert.deepEqual(created.mouse.map(call => call.ignore), [true])
  assert.ok(created.mouse.every(call => call.forward !== true), 'Creating a hidden window must not install a global mouse forwarding hook')
})
