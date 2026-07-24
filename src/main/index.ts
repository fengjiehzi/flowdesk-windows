import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import Store from 'electron-store'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UiohookMouseEvent } from 'uiohook-napi'
import {
  isSurfaceActive,
  pointInRectangle,
  triggerExitDecision,
  type IslandSurface,
  visibleSurfacesForState
} from '../shared/islandPresentation'
import { nextIslandState, type IslandEvent, type IslandState } from '../shared/islandState'
import { applySettingsPatch, defaultSettings, settingsSchema, themes, type IslandSettings } from '../shared/settings'
import {
  defaultTriggerStyle,
  triggerActivationLeft,
  triggerLeftFromPosition,
  triggerMovePhases,
  triggerPositionFromLeft,
  triggerSideMargin,
  triggerStyleDimensions,
  type TriggerMovePhase,
  type TriggerStyle,
  type TriggerVisualLayout
} from '../shared/triggerGesture'
import type { LauncherState, WebsiteShortcutInput } from '../shared/launcher'
import type { IslandSnapshot } from '../shared/types'
import { createLauncherStore, LauncherController } from './launcher'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, '../preload/index.cjs')
const iconPath = path.join(currentDir, '../../resources/app-icon.ico')
const surfaces: IslandSurface[] = ['trigger', 'compact', 'panel']
type SurfaceDimensions = { width: number; height: number; inset: number; contentWidth: number; contentHeight: number }
const fixedSurfaceWindows = {
  compact: { width: 164, height: 56, inset: 8, contentWidth: 148, contentHeight: 40 },
  panel: { width: 664, height: 274, inset: 12, contentWidth: 640, contentHeight: 250 }
} as const
const transitionMs = 180
const visibleTopOffset = 12
const themeLabels: Record<IslandSettings['theme'], string> = {
  graphite: '石墨黑',
  aurora: '极光绿',
  ember: '熔岩橙',
  cobalt: '钴蓝',
  plum: '梅紫',
  citrus: '柑橘',
  slate: '岩灰',
  rose: '玫瑰'
}
const windows: Record<IslandSurface, BrowserWindow | null> = { trigger: null, compact: null, panel: null }
let creatorWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let tray: Tray | null = null
let launcherController: LauncherController | null = null
let state: IslandState = 'HIDDEN'
let activeDisplayId: number | null = null
let transitionTimer: NodeJS.Timeout | null = null
let surfaceTimer: NodeJS.Timeout | null = null
let cursorTimer: NodeJS.Timeout | null = null
let clockTimer: NodeJS.Timeout | null = null
let suppressTopTriggerUntilLeave = false
let stopGlobalMouseHook: (() => void) | null = null
let settingsStore: Store<IslandSettings> | null = null
let triggerDrag: { pointerX: number; startLeft: number; currentLeft: number; displayId: number } | null = null
let triggerPullDistance = 0
let triggerStyle = defaultTriggerStyle
let triggerOutsideSince: number | null = null

let settings = defaultSettings

function validWindow(surface: IslandSurface) {
  const window = windows[surface]
  return window && !window.isDestroyed() ? window : null
}

function surfaceDimensions(surface: IslandSurface): SurfaceDimensions {
  if (surface === 'trigger') {
    const dimensions = triggerStyleDimensions[triggerStyle]
    const contentWidth = Math.round(dimensions.width * settings.fluidCloud.widthScale)
    const contentHeight = Math.round(dimensions.height * settings.fluidCloud.heightScale)
    return {
      width: contentWidth,
      height: contentHeight,
      inset: 0,
      contentWidth,
      contentHeight
    }
  }
  return fixedSurfaceWindows[surface]
}

function snapshot(): IslandSnapshot {
  return {
    state,
    settings,
    now: new Date().toISOString()
  }
}

function broadcastSnapshot(includeCreator = true) {
  const value = snapshot()
  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (window && !window.webContents.isDestroyed()) window.webContents.send('island:snapshot', value)
  }
  if (includeCreator && creatorWindow && !creatorWindow.isDestroyed() && !creatorWindow.webContents.isDestroyed()) {
    creatorWindow.webContents.send('island:snapshot', value)
  }
}

function broadcastLauncherState(value: LauncherState) {
  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (window && !window.webContents.isDestroyed()) window.webContents.send('launcher:state', value)
  }
  if (launcherWindow && !launcherWindow.isDestroyed() && !launcherWindow.webContents.isDestroyed()) {
    launcherWindow.webContents.send('launcher:state', value)
  }
}

function targetDisplay() {
  return screen.getAllDisplays().find((display) => display.id === activeDisplayId) ?? screen.getPrimaryDisplay()
}

function contentPosition(surface: IslandSurface) {
  const workArea = targetDisplay().workArea
  const dimensions = surfaceDimensions(surface)
  let x = Math.round(workArea.x + (workArea.width - dimensions.contentWidth) / 2)

  if (surface === 'trigger') {
    x = triggerDrag?.displayId === targetDisplay().id
      ? triggerDrag.currentLeft
      : triggerLeftFromPosition(workArea.x, workArea.width, dimensions.contentWidth, settings.triggerPosition)
  } else {
    if (settings.position === 'left') x = workArea.x + 24
    if (settings.position === 'right') x = workArea.x + workArea.width - dimensions.contentWidth - 24
  }

  return { x, y: surface === 'trigger' ? workArea.y : workArea.y + visibleTopOffset }
}

function contentBounds(surface: IslandSurface): Electron.Rectangle {
  const dimensions = surfaceDimensions(surface)
  return { ...contentPosition(surface), width: dimensions.contentWidth, height: dimensions.contentHeight }
}

function syncTriggerLayout() {
  const window = validWindow('trigger')
  if (!window) return
  const dimensions = surfaceDimensions('trigger')
  const layout = {
    focusX: dimensions.contentWidth / 2,
    pullDistance: triggerPullDistance,
    style: triggerStyle
  } satisfies TriggerVisualLayout
  if (!window.webContents.isDestroyed()) window.webContents.send('island:triggerVisualLayout', layout)
}

function positionWindows() {
  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (!window) continue
    const dimensions = surfaceDimensions(surface)
    const position = contentPosition(surface)
    window.setBounds({
      x: position.x - dimensions.inset,
      y: position.y - (surface === 'trigger' ? 0 : dimensions.inset),
      width: dimensions.width,
      height: dimensions.height
    })
  }
  syncTriggerLayout()
}

function syncSurfaceWindows() {
  positionWindows()
  const visible = visibleSurfacesForState(state)

  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (!window) continue
    if (visible[surface]) {
      if (!window.isVisible()) window.showInactive()
      window.setFocusable(true)
      window.setIgnoreMouseEvents(false)
    } else if (window.isVisible()) {
      window.setIgnoreMouseEvents(true, { forward: true })
      window.setFocusable(false)
    }
  }
  if (visible.trigger) validWindow('trigger')?.moveTop()

  broadcastSnapshot()
  if (surfaceTimer) clearTimeout(surfaceTimer)
  surfaceTimer = setTimeout(() => {
    for (const surface of surfaces) {
      const window = validWindow(surface)
      if (!window) continue
      if (isSurfaceActive(surface, state)) {
        if (!window.isVisible()) window.showInactive()
        window.setFocusable(true)
        window.setIgnoreMouseEvents(false)
      } else {
        window.setIgnoreMouseEvents(true, { forward: true })
        window.setFocusable(false)
        window.hide()
      }
    }
    if (state === 'TRIGGER_VISIBLE') validWindow('trigger')?.moveTop()
    surfaceTimer = null
  }, transitionMs)
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示灵动岛', click: revealCompact },
    { label: '隐藏灵动岛', click: hideIsland },
    {
      label: '主题',
      submenu: themes.map((theme) => ({
        label: themeLabels[theme],
        type: 'radio' as const,
        checked: settings.theme === theme,
        click: () => {
          if (settingsStore) updateSettings(settingsStore, { theme })
        }
      }))
    },
    { label: '流云创作器', click: () => void openCreatorWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]))
}

function setState(next: IslandState) {
  if (state === next) return
  triggerOutsideSince = null
  if (next !== 'TRIGGER_VISIBLE') {
    triggerDrag = null
    triggerPullDistance = 0
  }
  state = next
  syncSurfaceWindows()
  rebuildTrayMenu()
}

function transition(event: IslandEvent) {
  setState(nextIslandState(state, event))
}

function clearTransitionTimer() {
  if (transitionTimer) clearTimeout(transitionTimer)
  transitionTimer = null
}

function revealCompact() {
  clearTransitionTimer()
  if (state === 'HIDDEN') transition('SHOW_COMPACT')
  if (state === 'TRIGGER_VISIBLE') transition('ENTER_DONE')
  if (state === 'COLLAPSING') transition('COLLAPSE_DONE')
  if (state === 'ENTERING') {
    transitionTimer = setTimeout(() => {
      transition('ENTER_DONE')
      transitionTimer = null
    }, transitionMs)
  }
}

function revealTrigger() {
  clearTransitionTimer()
  if (state === 'HIDDEN') transition('POINTER_TOP')
}

function setExpanded(expanded: boolean) {
  clearTransitionTimer()

  if (expanded) {
    if (state === 'HIDDEN') transition('SHOW_COMPACT')
    if (state === 'COLLAPSING') transition('REENTER')
    else if (state === 'ENTERING' || state === 'COMPACT') transition('EXPAND')
    return
  }

  collapseToCompact()
}

function collapseToCompact() {
  clearTransitionTimer()
  if (state === 'TRIGGER_VISIBLE') transition('ENTER_DONE')
  if (state === 'SETTINGS_OPEN') transition('CLOSE_SETTINGS')
  if (state === 'EXPANDED') {
    transition('LEAVE_DELAY')
    transitionTimer = setTimeout(() => {
      transition('COLLAPSE_DONE')
      transitionTimer = null
    }, transitionMs)
  }
}

function hideIsland() {
  clearTransitionTimer()
  setState('HIDDEN')
}

function handleGlobalMouseDown(event: UiohookMouseEvent) {
  if (state === 'HIDDEN') return

  const point = screen.screenToDipPoint({ x: event.x, y: event.y })
  const insideIsland = surfaces.some((surface) => {
    if (!isSurfaceActive(surface, state)) return false
    const window = validWindow(surface)
    if (!window) return false
    return pointInRectangle(point, surface === 'trigger' ? contentBounds(surface) : window.getBounds())
  })
  if (insideIsland) return

  suppressTopTriggerUntilLeave = true
  hideIsland()
}

async function startGlobalMouseHook() {
  try {
    const { uIOhook } = await import('uiohook-napi')
    uIOhook.on('mousedown', handleGlobalMouseDown)
    try {
      uIOhook.start()
    } catch (error) {
      uIOhook.off('mousedown', handleGlobalMouseDown)
      throw error
    }
    stopGlobalMouseHook = () => {
      uIOhook.off('mousedown', handleGlobalMouseDown)
      uIOhook.stop()
    }
  } catch (error) {
    console.error('Unable to start global mouse hook:', error)
  }
}

function setSettingsOpen(open: boolean) {
  if (open) void openCreatorWindow()
  else creatorWindow?.hide()
}

function pointerInTrigger(point: Electron.Point) {
  const display = screen.getDisplayNearestPoint(point)
  const workArea = display.workArea
  return pointInRectangle(point, {
    x: triggerActivationLeft(workArea.x, workArea.width, settings.triggerWidth),
    y: workArea.y,
    width: settings.triggerWidth,
    height: settings.triggerHeight
  })
}

function moveTrigger(store: Store<IslandSettings>, phase: unknown, screenX: unknown) {
  if (!triggerMovePhases.includes(phase as TriggerMovePhase) || typeof screenX !== 'number' || !Number.isFinite(screenX)) return
  if (state !== 'TRIGGER_VISIBLE') return

  const window = validWindow('trigger')
  if (!window) return
  const display = targetDisplay()
  const workArea = display.workArea
  const dimensions = surfaceDimensions('trigger')

  if (phase === 'start') {
    const startLeft = contentPosition('trigger').x
    triggerDrag = {
      pointerX: screenX,
      startLeft,
      currentLeft: startLeft,
      displayId: display.id
    }
    return
  }

  if (phase === 'cancel') {
    triggerDrag = null
    positionWindows()
    return
  }

  if (!triggerDrag || triggerDrag.displayId !== display.id) return
  const minLeft = workArea.x + triggerSideMargin
  const maxLeft = workArea.x + workArea.width - dimensions.contentWidth - triggerSideMargin
  triggerDrag.currentLeft = Math.round(Math.max(minLeft, Math.min(maxLeft, triggerDrag.startLeft + screenX - triggerDrag.pointerX)))
  window.setBounds({
    x: triggerDrag.currentLeft - dimensions.inset,
    y: workArea.y,
    width: dimensions.width,
    height: dimensions.height
  })
  syncTriggerLayout()

  if (phase === 'end') {
    const position = triggerPositionFromLeft(workArea.x, workArea.width, dimensions.contentWidth, triggerDrag.currentLeft)
    triggerDrag = null
    updateSettings(store, { triggerPosition: position })
  }
}

function setTriggerPull(distance: unknown) {
  if (state !== 'TRIGGER_VISIBLE' || typeof distance !== 'number' || !Number.isFinite(distance)) return
  triggerPullDistance = Math.max(0, Math.min(8, distance))
  syncTriggerLayout()
}

function pollCursor() {
  if (!surfaces.some((surface) => validWindow(surface))) return
  if (state === 'HIDDEN' || state === 'TRIGGER_VISIBLE') {
    const point = screen.getCursorScreenPoint()
    if (state === 'HIDDEN') {
      const inTrigger = pointerInTrigger(point)
      if (!inTrigger) suppressTopTriggerUntilLeave = false
      else if (!suppressTopTriggerUntilLeave) {
        activeDisplayId = screen.getDisplayNearestPoint(point).id
        positionWindows()
        revealTrigger()
      }
    } else {
      const triggerWindow = validWindow('trigger')
      const decision = triggerExitDecision(
        pointerInTrigger(point),
        Boolean(triggerWindow && pointInRectangle(point, triggerWindow.getBounds())),
        triggerDrag !== null || triggerPullDistance > 0,
        triggerOutsideSince,
        Date.now(),
        settings.hideDelayMs
      )
      triggerOutsideSince = decision.outsideSince
      if (decision.hide) hideIsland()
    }
  }

  cursorTimer = setTimeout(pollCursor, state === 'TRIGGER_VISIBLE' && triggerOutsideSince !== null ? 60 : 120)
}

function loadSettings(store: Store<IslandSettings>) {
  const parsed = settingsSchema.safeParse({ ...defaultSettings, ...store.store })
  settings = parsed.success ? parsed.data : defaultSettings
  if (!parsed.success) store.store = defaultSettings
  triggerStyle = settings.fluidCloud.shape
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
}

function updateSettings(store: Store<IslandSettings>, patch: unknown) {
  const previousSettings = settings
  const previousTriggerStyle = triggerStyle
  settings = applySettingsPatch(settings, patch)
  triggerStyle = settings.fluidCloud.shape
  if (triggerStyle !== previousTriggerStyle) {
    triggerDrag = null
    triggerPullDistance = 0
  }
  store.store = settings
  if (settings.launchAtLogin !== previousSettings.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
  }
  if (
    settings.position !== previousSettings.position
    || settings.triggerPosition !== previousSettings.triggerPosition
    || settings.fluidCloud.shape !== previousSettings.fluidCloud.shape
    || settings.fluidCloud.widthScale !== previousSettings.fluidCloud.widthScale
    || settings.fluidCloud.heightScale !== previousSettings.fluidCloud.heightScale
  ) {
    positionWindows()
  }
  if (settings.theme !== previousSettings.theme) rebuildTrayMenu()
  broadcastSnapshot()
  return settings
}

function registerIpc(store: Store<IslandSettings>) {
  ipcMain.handle('island:getSnapshot', () => snapshot())
  ipcMain.handle('island:updateSettings', (_event, patch) => updateSettings(store, patch))
  ipcMain.handle('launcher:getState', () => launcherController?.getState())
  ipcMain.handle('launcher:discoverApps', (_event, refresh: boolean) => launcherController?.discoverInstalledApps(refresh))
  ipcMain.handle('launcher:addApps', (_event, candidateIds: unknown) => launcherController?.addInstalledApps(candidateIds))
  ipcMain.handle('launcher:pickApp', (event) => launcherController?.pickLocalApplication(BrowserWindow.fromWebContents(event.sender) ?? undefined))
  ipcMain.handle('launcher:addWebsite', (_event, input: WebsiteShortcutInput) => launcherController?.addWebsite(input))
  ipcMain.handle('launcher:rename', (_event, input: unknown) => launcherController?.renameEntry(input))
  ipcMain.handle('launcher:remove', (_event, entryId: unknown) => launcherController?.removeEntry(entryId))
  ipcMain.handle('launcher:reorder', (_event, entryIds: unknown) => launcherController?.reorderEntries(entryIds))
  ipcMain.handle('launcher:completeSetup', () => launcherController?.completeSetup())
  ipcMain.handle('launcher:launch', async (_event, entryId: unknown) => {
    await launcherController?.launchEntry(entryId)
    hideIsland()
  })
  ipcMain.on('launcher:openManager', () => void openLauncherWindow())
  ipcMain.on('island:setExpanded', (_event, expanded: boolean) => setExpanded(expanded))
  ipcMain.on('island:setSettingsOpen', (_event, open: boolean) => setSettingsOpen(open))
  ipcMain.on('island:moveTrigger', (event, phase: unknown, screenX: unknown) => {
    const triggerWindow = validWindow('trigger')
    if (triggerWindow && event.sender === triggerWindow.webContents) moveTrigger(store, phase, screenX)
  })
  ipcMain.on('island:setTriggerPull', (event, distance: unknown) => {
    const triggerWindow = validWindow('trigger')
    if (triggerWindow && event.sender === triggerWindow.webContents) setTriggerPull(distance)
  })
}

function rendererUrl(surface: IslandSurface | 'creator' | 'launcher') {
  const url = new URL(process.env.ELECTRON_RENDERER_URL as string)
  url.searchParams.set('surface', surface)
  return url.toString()
}

async function openLauncherWindow() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    if (!launcherWindow.isVisible()) launcherWindow.show()
    launcherWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 760,
    minHeight: 560,
    title: '快捷入口管理器',
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#07101b',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  launcherWindow = window
  window.on('close', () => launcherController?.completeSetup())
  window.on('closed', () => {
    if (launcherWindow === window) launcherWindow = null
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
  window.webContents.on('did-finish-load', () => {
    if (window.webContents.isDestroyed()) return
    window.webContents.send('island:snapshot', snapshot())
    const state = launcherController?.getState()
    if (state) window.webContents.send('launcher:state', state)
  })

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl('launcher'))
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'), { query: { surface: 'launcher' } })
}

async function openCreatorWindow() {
  if (creatorWindow && !creatorWindow.isDestroyed()) {
    if (!creatorWindow.isVisible()) creatorWindow.show()
    creatorWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 860,
    minHeight: 600,
    title: '流云创作器',
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#07101b',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  creatorWindow = window
  window.on('closed', () => {
    if (creatorWindow === window) creatorWindow = null
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
  window.webContents.on('did-finish-load', () => {
    if (!window.webContents.isDestroyed()) window.webContents.send('island:snapshot', snapshot())
  })

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl('creator'))
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'), { query: { surface: 'creator' } })
}

async function createSurfaceWindow(surface: IslandSurface) {
  const dimensions = surfaceDimensions(surface)
  const window = new BrowserWindow({
    width: dimensions.width,
    height: dimensions.height,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true,
    backgroundColor: '#00000000',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  windows[surface] = window
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setIgnoreMouseEvents(true, { forward: true })
  window.on('closed', () => {
    if (windows[surface] === window) windows[surface] = null
  })

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl(surface))
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'), { query: { surface } })
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Windows 灵动岛')
  tray.on('click', () => {
    activeDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    positionWindows()
    revealCompact()
  })
  rebuildTrayMenu()
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', revealCompact)
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.desktop.dynamicisland')
    settingsStore = new Store<IslandSettings>({ name: 'settings', defaults: defaultSettings })
    launcherController = new LauncherController(createLauncherStore(), broadcastLauncherState)
    loadSettings(settingsStore)
    registerIpc(settingsStore)
    await Promise.all(surfaces.map(createSurfaceWindow))
    positionWindows()
    syncSurfaceWindows()
    createTray()
    if (!launcherController.getState().setupCompleted) await openLauncherWindow()
    await startGlobalMouseHook()
    clockTimer = setInterval(() => broadcastSnapshot(false), 1000)
    pollCursor()
    screen.on('display-added', positionWindows)
    screen.on('display-removed', positionWindows)
    screen.on('display-metrics-changed', positionWindows)
  })
}

app.on('activate', revealCompact)
app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  clearTransitionTimer()
  if (surfaceTimer) clearTimeout(surfaceTimer)
  if (cursorTimer) clearTimeout(cursorTimer)
  if (clockTimer) clearInterval(clockTimer)
  tray?.destroy()
  launcherWindow?.destroy()
  creatorWindow?.destroy()
  try {
    stopGlobalMouseHook?.()
  } catch (error) {
    console.error('Unable to stop global mouse hook:', error)
  }
})
