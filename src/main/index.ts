import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import Store from 'electron-store'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSurfaceActive, pointInRectangle, surfaceWindowMode, type IslandSurface } from '../shared/islandPresentation'
import { nextIslandState, type IslandEvent, type IslandState } from '../shared/islandState'
import { applySettingsPatch, defaultSettings, settingsSchema, themes, type IslandSettings } from '../shared/settings'
import type { LauncherState, WebsiteShortcutInput } from '../shared/launcher'
import { nextNotificationPreviewDeadline, type NotificationCenterState } from '../shared/notifications'
import type { IslandSnapshot } from '../shared/types'
import { createLauncherStore, LauncherController } from './launcher'
import { NotificationController } from './notifications'

// ponytail: required for Chromium GPU startup on systems with mixed physical/virtual display adapters.
app.commandLine.appendSwitch('disable-gpu-sandbox')

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, '../preload/index.cjs')
const iconPath = path.join(currentDir, '../../resources/app-icon.ico')
const surfaces: IslandSurface[] = ['compact', 'panel']
type SurfaceDimensions = { width: number; height: number; inset: number; contentWidth: number; contentHeight: number }
const fixedSurfaceWindows = {
  compact: { width: 164, height: 56, inset: 8, contentWidth: 148, contentHeight: 40 },
  notification: { width: 454, height: 92, inset: 12, contentWidth: 430, contentHeight: 68 },
  panel: { width: 664, height: 274, inset: 12, contentWidth: 640, contentHeight: 250 }
} as const
const globalShortcutAccelerator = 'Ctrl+Alt+Space'
const transitionMs = 180
const visibleTopOffset = 12
const logPrefix = '[灵动岛]'
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
const windows: Record<IslandSurface, BrowserWindow | null> = { compact: null, panel: null }
let creatorWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let tray: Tray | null = null
let launcherController: LauncherController | null = null
let notificationController: NotificationController | null = null
let state: IslandState = 'HIDDEN'
let activeDisplayId: number | null = null
let transitionTimer: NodeJS.Timeout | null = null
let surfaceTimer: NodeJS.Timeout | null = null
let cursorTimer: NodeJS.Timeout | null = null
let clockTimer: NodeJS.Timeout | null = null
let settingsStore: Store<IslandSettings> | null = null
let surfaceOutsideSince: number | null = null
let pointerEnteredIsland = false
let panelView: 'launcher' | 'notifications' = 'launcher'
let notificationTimer: NodeJS.Timeout | null = null
let notificationStartedAt = 0
let notificationDeadline = 0
let notificationPausedAt = 0
let notificationVisible = false
  let shortcutRegistered = false
  let quitStarted = false
  let quitReady = false
  let syncSequence = 0

let settings = defaultSettings

function cleanupTimers() {
  if (transitionTimer) clearTimeout(transitionTimer)
  if (surfaceTimer) clearTimeout(surfaceTimer)
  if (cursorTimer) clearTimeout(cursorTimer)
  if (clockTimer) clearInterval(clockTimer)
  if (notificationTimer) clearTimeout(notificationTimer)
  transitionTimer = null
  surfaceTimer = null
  cursorTimer = null
  clockTimer = null
  notificationTimer = null
}

function log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const timestamp = new Date().toISOString()
  const prefix = `${logPrefix}[${timestamp}]`
  if (level === 'error') console.error(prefix, message)
  else if (level === 'warn') console.warn(prefix, message)
  else console.log(prefix, message)
}

function clipboardArchivePath() {
  return path.join(app.getPath('documents'), 'Windows灵动岛', '剪贴板记录')
}

function validWindow(surface: IslandSurface) {
  const window = windows[surface]
  return window && !window.isDestroyed() ? window : null
}

function surfaceDimensions(surface: IslandSurface): SurfaceDimensions {
  if (surface === 'compact' && notificationVisible) return fixedSurfaceWindows.notification
  return fixedSurfaceWindows[surface]
}

function snapshot(): IslandSnapshot {
  return {
    state,
    compactMode: notificationVisible ? 'notification' : 'clock',
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
  if (includeCreator && settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.webContents.isDestroyed()) {
    settingsWindow.webContents.send('island:snapshot', value)
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

function broadcastNotificationState(value = notificationController?.getState()) {
  if (!value) return
  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (window && !window.webContents.isDestroyed()) window.webContents.send('notifications:state', value)
  }
  for (const window of [creatorWindow, settingsWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('notifications:state', value)
    }
  }
}

function targetDisplay() {
  return screen.getAllDisplays().find((display) => display.id === activeDisplayId) ?? screen.getPrimaryDisplay()
}

function contentPosition(surface: IslandSurface) {
  const workArea = targetDisplay().workArea
  const dimensions = surfaceDimensions(surface)
  let x = Math.round(workArea.x + (workArea.width - dimensions.contentWidth) / 2)
  if (settings.position === 'left') x = workArea.x + 24
  if (settings.position === 'right') x = workArea.x + workArea.width - dimensions.contentWidth - 24
  return { x, y: workArea.y + visibleTopOffset }
}

function positionWindows() {
  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (!window) continue
    const dimensions = surfaceDimensions(surface)
    const position = contentPosition(surface)
    window.setBounds({
      x: position.x - dimensions.inset,
      y: position.y - dimensions.inset,
      width: dimensions.width,
      height: dimensions.height
    })
  }
}

function syncSurfaceWindows() {
  positionWindows()

  const currentSequence = ++syncSequence

  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (!window) continue
    const mode = surfaceWindowMode(surface, state, notificationVisible)
    if (mode !== 'hidden') {
      if (!window.isVisible()) window.showInactive()
      window.setFocusable(mode === 'active' && !notificationVisible)
      window.setIgnoreMouseEvents(mode !== 'active', { forward: true })
      window.moveTop()
    } else if (window.isVisible()) {
      window.setIgnoreMouseEvents(true, { forward: true })
      window.setFocusable(false)
    }
  }

  broadcastSnapshot()
  if (surfaceTimer) clearTimeout(surfaceTimer)
  surfaceTimer = setTimeout(() => {
    if (syncSequence !== currentSequence) return
    for (const surface of surfaces) {
      const window = validWindow(surface)
      if (!window) continue
      const mode = surfaceWindowMode(surface, state, notificationVisible)
      if (mode !== 'hidden') {
        if (!window.isVisible()) window.showInactive()
        window.setFocusable(mode === 'active' && !notificationVisible)
        window.setIgnoreMouseEvents(mode !== 'active', { forward: true })
      } else {
        window.setIgnoreMouseEvents(true, { forward: true })
        window.setFocusable(false)
        window.hide()
      }
    }
    surfaceTimer = null
  }, transitionMs)
}

function hideNotificationPreview() {
  if (notificationTimer) clearTimeout(notificationTimer)
  notificationTimer = null
  notificationVisible = false
  notificationStartedAt = 0
  notificationDeadline = 0
  notificationPausedAt = 0
  syncSequence++
  syncSurfaceWindows()
}

function scheduleNotificationHide() {
  if (notificationTimer) clearTimeout(notificationTimer)
  if (!notificationVisible || notificationPausedAt) return
  const remaining = notificationDeadline - Date.now()
  if (remaining <= 0) {
    hideNotificationPreview()
    return
  }
  notificationTimer = setTimeout(hideNotificationPreview, remaining)
}

function canShowNotificationPreview(centerState: NotificationCenterState) {
  return centerState.suppression === 'accepts'
    && state !== 'EXPANDED'
    && state !== 'SETTINGS_OPEN'
    && !(creatorWindow?.isVisible() || settingsWindow?.isVisible() || launcherWindow?.isVisible())
}

function showNotificationPreview() {
  const centerState = notificationController?.getState()
  const window = validWindow('compact')
  if (!centerState || !window || !canShowNotificationPreview(centerState)) return

  const now = Date.now()
  if (!notificationVisible) notificationStartedAt = now
  notificationVisible = true
  notificationDeadline = nextNotificationPreviewDeadline(notificationStartedAt, now)
  activeDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  syncSequence++
  syncSurfaceWindows()
  broadcastNotificationState(centerState)
  scheduleNotificationHide()
}

function setNotificationHovered(hovered: boolean) {
  if (!notificationVisible) return
  if (hovered && !notificationPausedAt) {
    notificationPausedAt = Date.now()
    if (notificationTimer) clearTimeout(notificationTimer)
    notificationTimer = null
  } else if (!hovered && notificationPausedAt) {
    const pausedFor = Date.now() - notificationPausedAt
    notificationStartedAt += pausedFor
    notificationDeadline += pausedFor
    notificationPausedAt = 0
    scheduleNotificationHide()
  }
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: shortcutRegistered ? `显示灵动岛 (${globalShortcutAccelerator})` : '显示灵动岛（快捷键不可用）', click: revealCompactOnCursorDisplay },
    { label: '隐藏灵动岛', click: hideIsland },
    { label: '设置', click: () => void openSettingsWindow() },
    { type: 'separator' },
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
  const previous = state
  state = next
  syncSequence++
  if (next === 'HIDDEN') {
    pointerEnteredIsland = false
    surfaceOutsideSince = null
  }
  log(`状态转换: ${previous} -> ${next}`)
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
  if (state === 'COLLAPSING') transition('COLLAPSE_DONE')
  if (state === 'ENTERING') {
    transitionTimer = setTimeout(() => {
      transition('ENTER_DONE')
      transitionTimer = null
    }, transitionMs)
  }
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
  if (surfaceTimer) {
    clearTimeout(surfaceTimer)
    surfaceTimer = null
  }
  transition('HIDE')
}

function pollCursor() {
  if (!surfaces.some((surface) => validWindow(surface))) return

  if (state !== 'HIDDEN' && !notificationVisible) {
    const point = screen.getCursorScreenPoint()
    const insideIsland = surfaces.some((surface) => {
      if (!isSurfaceActive(surface, state)) return false
      const window = validWindow(surface)
      return Boolean(window && pointInRectangle(point, window.getBounds()))
    })

    if (insideIsland) {
      pointerEnteredIsland = true
      surfaceOutsideSince = null
    } else if (pointerEnteredIsland) {
      surfaceOutsideSince ??= Date.now()
      if (Date.now() - surfaceOutsideSince >= settings.hideDelayMs) hideIsland()
    }
  }

  cursorTimer = setTimeout(pollCursor, 120)
}

function revealCompactOnCursorDisplay() {
  activeDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  positionWindows()
  revealCompact()
}

function registerGlobalShortcut() {
  shortcutRegistered = globalShortcut.register(globalShortcutAccelerator, revealCompactOnCursorDisplay)
  if (!shortcutRegistered) log(`无法注册全局快捷键: ${globalShortcutAccelerator}`, 'warn')
  else log(`全局快捷键已注册: ${globalShortcutAccelerator}`)
}

function loadSettings(store: Store<IslandSettings>) {
  const parsed = settingsSchema.safeParse({ ...defaultSettings, ...store.store })
  settings = parsed.success ? parsed.data : defaultSettings
  if (!parsed.success) store.store = defaultSettings
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
}

function updateSettings(store: Store<IslandSettings>, patch: unknown) {
  const previousSettings = settings
  settings = applySettingsPatch(settings, patch)
  store.store = settings
  if (settings.launchAtLogin !== previousSettings.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
    log(`开机自启: ${settings.launchAtLogin ? '已启用' : '已禁用'}`)
  }
  if (settings.position !== previousSettings.position) positionWindows()
  if (settings.theme !== previousSettings.theme) rebuildTrayMenu()
  if (
    settings.notificationsEnabled !== previousSettings.notificationsEnabled
    || settings.desktopPopupNotificationsEnabled !== previousSettings.desktopPopupNotificationsEnabled
    || settings.clipboardArchiveEnabled !== previousSettings.clipboardArchiveEnabled
    || JSON.stringify(settings.mutedNotificationApps) !== JSON.stringify(previousSettings.mutedNotificationApps)
  ) {
    notificationController?.configure()
    if (!settings.notificationsEnabled) hideNotificationPreview()
    else broadcastNotificationState()
  }
  broadcastSnapshot()
  return settings
}

function openPanel(view: 'launcher' | 'notifications' = 'launcher') {
  hideNotificationPreview()
  panelView = view
  revealCompact()
  setExpanded(true)
  const panel = validWindow('panel')
  if (panel && !panel.webContents.isDestroyed()) panel.webContents.send('island:panelView', panelView)
  if (view === 'notifications') notificationController?.markRead()
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
  ipcMain.handle('notifications:getState', () => notificationController?.getState())
  ipcMain.handle('notifications:requestAccess', () => {
    updateSettings(store, { notificationsEnabled: true, notificationOnboardingDismissed: true })
    notificationController?.requestAccess()
    return notificationController?.getState()
  })
  ipcMain.handle('notifications:markRead', () => notificationController?.markRead())
  ipcMain.handle('notifications:clear', () => notificationController?.clear())
  ipcMain.handle('notifications:openSettings', () => shell.openExternal('ms-settings:privacy-notifications'))
  ipcMain.handle('clipboardArchive:openDirectory', async () => {
    const directory = clipboardArchivePath()
    await mkdir(directory, { recursive: true })
    const error = await shell.openPath(directory)
    if (error) throw new Error(error)
  })
  ipcMain.handle('notifications:openSource', (_event, appId: unknown) => {
    if (typeof appId !== 'string' || !appId.trim() || appId.length > 512) return
    if (notificationController?.openSource(appId)) return
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], { detached: true, windowsHide: true })
    child.unref()
  })
  ipcMain.on('notifications:openPanel', (_event, view: unknown) => {
    openPanel(view === 'notifications' ? 'notifications' : 'launcher')
  })
  ipcMain.on('notifications:hovered', (_event, hovered: boolean) => setNotificationHovered(Boolean(hovered)))
  ipcMain.on('launcher:openManager', () => void openLauncherWindow())
  ipcMain.on('island:setExpanded', (_event, expanded: boolean) => setExpanded(expanded))
  ipcMain.on('creator:open', () => {
    hideNotificationPreview()
    void openCreatorWindow()
  })
}

function rendererUrl(surface: IslandSurface | 'creator' | 'settings' | 'launcher') {
  const url = new URL(process.env.ELECTRON_RENDERER_URL as string)
  url.searchParams.set('surface', surface)
  return url.toString()
}

async function openLauncherWindow() {
  hideNotificationPreview()
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

async function openSettingsWindow() {
  hideNotificationPreview()
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (!settingsWindow.isVisible()) settingsWindow.show()
    settingsWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 480,
    minHeight: 560,
    title: '设置',
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

  settingsWindow = window
  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
  window.webContents.on('did-finish-load', () => {
    if (window.webContents.isDestroyed()) return
    window.webContents.send('island:snapshot', snapshot())
    const notificationState = notificationController?.getState()
    if (notificationState) window.webContents.send('notifications:state', notificationState)
  })

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl('settings'))
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'), { query: { surface: 'settings' } })
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
    if (!windows.compact && !windows.panel) {
      cleanupTimers()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl(surface))
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'), { query: { surface } })
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Windows 灵动岛')
  tray.on('click', revealCompactOnCursorDisplay)
  rebuildTrayMenu()
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', revealCompactOnCursorDisplay)
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.desktop.dynamicisland')
    settingsStore = new Store<IslandSettings>({ name: 'settings', defaults: defaultSettings })
    launcherController = new LauncherController(createLauncherStore(), broadcastLauncherState)
    loadSettings(settingsStore)
    notificationController = new NotificationController({
      bridgePath: app.isPackaged
        ? path.join(process.resourcesPath, 'native', 'NotificationBridge.exe')
        : path.join(currentDir, '../../build/generated/native/NotificationBridge.exe'),
      clipboardArchivePath,
      settings: () => settings,
      onState: broadcastNotificationState,
      onNotification: showNotificationPreview
    })
    registerIpc(settingsStore)
    await Promise.all(surfaces.map(createSurfaceWindow))
    positionWindows()
    syncSurfaceWindows()
    notificationController.configure()
    registerGlobalShortcut()
    createTray()
    if (!launcherController.getState().setupCompleted) await openLauncherWindow()
    clockTimer = setInterval(() => broadcastSnapshot(false), 1000)
    pollCursor()
    screen.on('display-added', positionWindows)
    screen.on('display-removed', positionWindows)
    screen.on('display-metrics-changed', positionWindows)
  })
}

app.on('activate', revealCompactOnCursorDisplay)
app.on('window-all-closed', () => {})
app.on('before-quit', (event) => {
  if (quitReady) return
  event.preventDefault()
  if (quitStarted) return
  quitStarted = true
  log('正在退出应用...')
  clearTransitionTimer()
  if (surfaceTimer) clearTimeout(surfaceTimer)
  if (cursorTimer) clearTimeout(cursorTimer)
  if (clockTimer) clearInterval(clockTimer)
  if (notificationTimer) clearTimeout(notificationTimer)
  tray?.destroy()
  launcherWindow?.destroy()
  creatorWindow?.destroy()
  settingsWindow?.destroy()
  globalShortcut.unregisterAll()
  void Promise.resolve(notificationController?.shutdown()).finally(() => {
    quitReady = true
    log('应用已退出')
    app.quit()
  })
})
