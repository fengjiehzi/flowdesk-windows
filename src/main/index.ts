import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import Store from 'electron-store'
import electronLog from 'electron-log/main'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSurfaceActive, pointInRectangle, surfaceWindowMode, type IslandSurface } from '../shared/islandPresentation'
import { nextIslandState, type IslandEvent, type IslandState } from '../shared/islandState'
import { topEdgeBounds } from '../shared/edgeActivation'
import { applySettingsPatch, defaultSettings, recoverSettings, settingsSchema, themes, type IslandSettings } from '../shared/settings'
import type { LauncherState, WebsiteShortcutInput } from '../shared/launcher'
import { nextNotificationPreviewDeadline, type NotificationCenterState } from '../shared/notifications'
import type { IslandPanelView, IslandSnapshot } from '../shared/types'
import { createLauncherStore, LauncherController } from './launcher'
import { NotificationController } from './notifications'
import { createSafeStore, loadRecoverableConfig } from './configRecovery'
import { isTrustedRendererUrl } from './rendererSecurity'
import { DesktopBoxesController } from './desktopBoxes'
import type { DesktopBoxesAction, DesktopBoxesState } from '../shared/desktopBoxes'

// ponytail: required for Chromium GPU startup on systems with mixed physical/virtual display adapters.
app.commandLine.appendSwitch('disable-gpu-sandbox')

// Keep the existing profile and single-instance lock when the product name changes.
const legacyUserDataPath = path.join(app.getPath('appData'), 'Windows 灵动岛')
mkdirSync(legacyUserDataPath, { recursive: true })
app.setPath('userData', legacyUserDataPath)

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, '../preload/index.cjs')
const iconPath = path.join(currentDir, '../../resources/app-icon.ico')
const surfaces: IslandSurface[] = ['compact']
type SurfaceDimensions = { width: number; height: number; inset: number; contentWidth: number; contentHeight: number }
const fixedSurfaceWindows = {
  compact: { width: 164, height: 56, inset: 8, contentWidth: 148, contentHeight: 40 },
  notification: { width: 454, height: 92, inset: 12, contentWidth: 430, contentHeight: 68 },
  panel: { width: 808, height: 488, inset: 12, contentWidth: 784, contentHeight: 464 }
} as const
const transitionMs = 260
const visibleTopOffset = 12
const logPrefix = '[流屿桌面]'
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
const themeAccents: Record<IslandSettings['theme'], string> = {
  graphite: '#52d273',
  aurora: '#59d6a2',
  ember: '#e58a5b',
  cobalt: '#5ca7ed',
  plum: '#bd82c9',
  citrus: '#b6d45f',
  slate: '#7fa6c9',
  rose: '#dd7899'
}
const windows: Record<IslandSurface, BrowserWindow | null> = { compact: null, panel: null }
let edgeWindow: BrowserWindow | null = null
let creatorWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let tray: Tray | null = null
let launcherController: LauncherController | null = null
let notificationController: NotificationController | null = null
let desktopBoxesController: DesktopBoxesController | null = null
let state: IslandState = 'HIDDEN'
let activeDisplayId: number | null = null
let surfaceTimer: NodeJS.Timeout | null = null
let morphBoundsTimer: NodeJS.Timeout | null = null
let morphHoldPanelBounds = false
let cursorTimer: NodeJS.Timeout | null = null
let clockTimer: NodeJS.Timeout | null = null
let settingsStore: Store<IslandSettings> | null = null
let surfaceOutsideSince: number | null = null
let pointerEnteredIsland = false
let panelView: IslandPanelView = 'launcher'
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
const recoveryBackups: string[] = []
let settingsRevision = 0
const closeRequests = new Map<number, { id: number; finish: (ready: boolean) => void }>()
const approvedCloses = new WeakSet<BrowserWindow>()
let closeRequestId = 0

function cleanupTimers() {
  if (surfaceTimer) clearTimeout(surfaceTimer)
  if (morphBoundsTimer) clearTimeout(morphBoundsTimer)
  if (cursorTimer) clearTimeout(cursorTimer)
  if (clockTimer) clearTimeout(clockTimer)
  if (notificationTimer) clearTimeout(notificationTimer)
  surfaceTimer = null
  morphBoundsTimer = null
  cursorTimer = null
  clockTimer = null
  notificationTimer = null
}

function log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const timestamp = new Date().toISOString()
  const prefix = `${logPrefix}[${timestamp}]`
  if (level === 'error') electronLog.error(prefix, message)
  else if (level === 'warn') electronLog.warn(prefix, message)
  else electronLog.info(prefix, message)
}

function clipboardArchivePath() {
  return path.join(app.getPath('documents'), 'Windows灵动岛', '剪贴板记录')
}

function validWindow(surface: IslandSurface) {
  const window = windows[surface]
  return window && !window.isDestroyed() ? window : null
}

function surfaceDimensions(surface: IslandSurface): SurfaceDimensions {
  if (surface === 'panel' || (typeof surfaces !== 'undefined' && surfaces.length === 1 && (state === 'EXPANDED' || morphHoldPanelBounds) && !notificationVisible)) {
    const area = (screen.getAllDisplays().find(display => display.id === activeDisplayId) ?? screen.getPrimaryDisplay()).workArea
    const width = Math.min(fixedSurfaceWindows.panel.width, area.width)
    const height = Math.min(fixedSurfaceWindows.panel.height, area.height - visibleTopOffset)
    return { ...fixedSurfaceWindows.panel, width, height, contentWidth: width - 24, contentHeight: height - 24 }
  }
  if (surface === 'compact' && notificationVisible) return fixedSurfaceWindows.notification
  return fixedSurfaceWindows[surface]
}

function snapshot(): IslandSnapshot {
  return {
    state,
    compactMode: notificationVisible ? 'notification' : 'clock',
    settings,
    now: new Date().toISOString(),
    settingsRevision,
    shortcutRegistered,
    panelView
  }
}

function broadcastSnapshot(includeCreator = true) {
  const value = snapshot()
  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (window && !window.webContents.isDestroyed()) window.webContents.send('island:snapshot', value)
  }
  if (includeCreator) {
    for (const window of [creatorWindow, settingsWindow, launcherWindow]) {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('island:snapshot', value)
      }
    }
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

function positionEdgeWindow() {
  if (!edgeWindow || edgeWindow.isDestroyed()) return
  const display = targetDisplay()
  const bounds = topEdgeBounds(display, settings.position)
  edgeWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 2 })
}

function syncEdgeWindowVisibility() {
  if (!edgeWindow || edgeWindow.isDestroyed()) return
  const secondaryVisible = Boolean(creatorWindow?.isVisible() || settingsWindow?.isVisible() || launcherWindow?.isVisible())
  const fullscreenActive = notificationController?.getState().suppression === 'fullscreen'
  const shouldShow = state === 'HIDDEN' && !notificationVisible && !quitStarted && !secondaryVisible && !fullscreenActive
  if (shouldShow) {
    positionEdgeWindow()
    if (!edgeWindow.isVisible()) edgeWindow.showInactive()
    edgeWindow.moveTop()
  } else if (edgeWindow.isVisible()) {
    edgeWindow.hide()
  }
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
  if (typeof positionEdgeWindow === 'function') positionEdgeWindow()
}

function syncSurfaceWindows() {
  positionWindows()

  const currentSequence = ++syncSequence

  for (const surface of surfaces) {
    const window = validWindow(surface)
    if (!window) continue
    const mode = surfaces.length === 1
      ? (state === 'HIDDEN' && !notificationVisible ? 'hidden' : 'active')
      : surfaceWindowMode(surface, state, notificationVisible)
    if (mode !== 'hidden') {
      if (!window.isVisible()) window.showInactive()
      window.setFocusable(mode === 'active' && !notificationVisible)
      window.setIgnoreMouseEvents(mode !== 'active')
      window.moveTop()
    } else if (window.isVisible()) {
      window.setIgnoreMouseEvents(true)
      window.setFocusable(false)
    }
  }

  broadcastSnapshot()
  if (typeof syncEdgeWindowVisibility === 'function') syncEdgeWindowVisibility()
  if (typeof ensureLeavePolling === 'function') ensureLeavePolling()
  if (surfaceTimer) clearTimeout(surfaceTimer)
  surfaceTimer = setTimeout(() => {
    if (syncSequence !== currentSequence) return
    for (const surface of surfaces) {
      const window = validWindow(surface)
      if (!window) continue
      const mode = surfaces.length === 1
        ? (state === 'HIDDEN' && !notificationVisible ? 'hidden' : 'active')
        : surfaceWindowMode(surface, state, notificationVisible)
      if (mode !== 'hidden') {
        if (!window.isVisible()) window.showInactive()
        window.setFocusable(mode === 'active' && !notificationVisible)
        window.setIgnoreMouseEvents(mode !== 'active')
        window.webContents?.setBackgroundThrottling?.(false)
      } else {
        window.setIgnoreMouseEvents(true)
        window.setFocusable(false)
        window.hide()
        window.webContents?.setBackgroundThrottling?.(true)
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
    { label: shortcutRegistered ? `显示流屿桌面 (${settings.shortcutAccelerator})` : '显示流屿桌面（快捷键冲突不可用）', click: triggerGlobalShortcut },
    { label: '隐藏流屿桌面', click: hideIsland },
    { label: '设置', click: () => void openSettingsWindow() },
    { label: '桌面整理', submenu: [
      { label: '显示桌面盒子', click: () => void runDesktopBoxesAction('show') },
      { label: '恢复系统桌面', click: () => void runDesktopBoxesAction('hide') },
      { label: '分类管理与备份', click: () => void runDesktopBoxesAction('manage') },
      { label: '桌面整理设置', click: () => void runDesktopBoxesAction('settings') },
      { label: '重新扫描桌面', click: () => void runDesktopBoxesAction('refresh') }
    ] },
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

function broadcastDesktopBoxesState(value: DesktopBoxesState) {
  for (const window of Object.values(windows)) {
    if (window && !window.isDestroyed()) window.webContents.send('desktopBoxes:state', value)
  }
}

async function runDesktopBoxesAction(action: DesktopBoxesAction) {
  try { await desktopBoxesController?.command(action) }
  catch (error) { dialog.showErrorBox('桌面整理操作未完成', error instanceof Error ? error.message : '请稍后重试') }
}

function setState(next: IslandState) {
  if (state === next) return
  const previous = state
  if (morphBoundsTimer) {
    clearTimeout(morphBoundsTimer)
    morphBoundsTimer = null
  }
  if (previous === 'EXPANDED' && next === 'COMPACT') {
    morphHoldPanelBounds = true
    morphBoundsTimer = setTimeout(() => {
      morphHoldPanelBounds = false
      morphBoundsTimer = null
      positionWindows()
    }, transitionMs)
  } else {
    morphHoldPanelBounds = false
  }
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

function activeIslandWindow() {
  return surfaces.length === 1 ? validWindow('compact') : validWindow('panel')
}

function setExpanded(expanded: boolean) {
  if (expanded) {
    surfaceOutsideSince = null
    setState('EXPANDED')
    activeIslandWindow()?.focus()
    return
  }
  if (state !== 'HIDDEN') revealCompact()
}

function revealCompact() {
  setState('COMPACT')
}

function hideIsland() {
  if (surfaceTimer) {
    clearTimeout(surfaceTimer)
    surfaceTimer = null
  }
  if (notificationVisible) hideNotificationPreview()
  transition('HIDE')
}

function ensureLeavePolling() {
  if (state !== 'HIDDEN' && !notificationVisible) {
    if (!cursorTimer) cursorTimer = setTimeout(pollLeaveCursor, 120)
  } else if (cursorTimer) {
    clearTimeout(cursorTimer)
    cursorTimer = null
  }
}

// 仅在胶囊或面板处于可见态时检测鼠标离开自动收起；隐藏待机态零轮询。
function pollLeaveCursor() {
  cursorTimer = null
  if (state === 'HIDDEN' || notificationVisible) return
  if (!surfaces.some((surface) => validWindow(surface))) return

  const now = Date.now()
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const insideEdge = pointInRectangle(point, topEdgeBounds(display, settings.position))
  const insideIsland = surfaces.some((surface) => {
    if (surfaces.length > 1 && !isSurfaceActive(surface, state)) return false
    const window = validWindow(surface)
    return Boolean(window && pointInRectangle(point, window.getBounds()))
  })

  if (insideIsland || (insideEdge && display.id === activeDisplayId)) {
    pointerEnteredIsland = true
    surfaceOutsideSince = null
  } else if (pointerEnteredIsland) {
    surfaceOutsideSince ??= now
    if (now - surfaceOutsideSince >= settings.hideDelayMs) {
      hideIsland()
      return
    }
  }

  cursorTimer = setTimeout(pollLeaveCursor, 120)
}

function revealCompactOnCursorDisplay() {
  activeDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  pointerEnteredIsland = false
  positionWindows()
  revealCompact()
  validWindow('compact')?.focus()
}

function triggerGlobalShortcut() {
  if (state === 'EXPANDED') {
    hideIsland()
    return
  }
  activeDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  if (settings.hotkeyDirectExpand) {
    openPanel('launcher')
  } else {
    revealCompactOnCursorDisplay()
  }
}

function registerGlobalShortcut() {
  globalShortcut.unregisterAll()
  try {
    shortcutRegistered = globalShortcut.register(settings.shortcutAccelerator, triggerGlobalShortcut)
  } catch {
    shortcutRegistered = false
  }
  if (!shortcutRegistered) log(`无法注册全局快捷键: ${settings.shortcutAccelerator}`, 'warn')
  else log(`全局快捷键已注册: ${settings.shortcutAccelerator}`)
}

function loadSettings(store: Store<IslandSettings>) {
  const loaded = loadRecoverableConfig(store, settingsSchema, recoverSettings)
  settings = loaded.data
  if (loaded.backupPath) recoveryBackups.push(loaded.backupPath)
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
}

function updateSettings(store: Store<IslandSettings>, patch: unknown) {
  const previousSettings = settings
  const nextSettings = applySettingsPatch(settings, patch)
  store.store = nextSettings
  settings = nextSettings
  settingsRevision++
  if (settings.launchAtLogin !== previousSettings.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
    log(`开机自启: ${settings.launchAtLogin ? '已启用' : '已禁用'}`)
  }
  if (settings.shortcutAccelerator !== previousSettings.shortcutAccelerator) {
    if (typeof registerGlobalShortcut === 'function') registerGlobalShortcut()
    if (typeof rebuildTrayMenu === 'function') rebuildTrayMenu()
  }
  if (settings.position !== previousSettings.position) positionWindows()
  if (settings.theme !== previousSettings.theme) {
    if (typeof rebuildTrayMenu === 'function') rebuildTrayMenu()
    if (typeof desktopBoxesController !== 'undefined' && typeof themeAccents !== 'undefined') {
      void desktopBoxesController?.syncTheme(themeAccents[settings.theme])
    }
  }
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

function openPanel(view: IslandPanelView = 'launcher') {
  hideNotificationPreview()
  panelView = view
  surfaceOutsideSince = null
  setExpanded(true)
  const target = activeIslandWindow()
  if (target && !target.webContents.isDestroyed()) target.webContents.send('island:panelView', panelView)
  if (view === 'notifications') notificationController?.markRead()
}

function prepareWindowClose(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const id = ++closeRequestId
    const senderId = window.webContents.id
    const finish = (ready: boolean) => {
      clearTimeout(timer)
      closeRequests.delete(senderId)
      resolve(ready)
    }
    const timer = setTimeout(() => finish(false), 10_000)
    closeRequests.get(senderId)?.finish(false)
    closeRequests.set(senderId, { id, finish })
    window.webContents.send('island:prepareClose', id)
  })
}

function protectWindowClose(window: BrowserWindow) {
  let preparing = false
  window.on('close', (event) => {
    if (approvedCloses.has(window) || quitReady) return
    event.preventDefault()
    if (preparing) return
    preparing = true
    void prepareWindowClose(window).then((ready) => {
      preparing = false
      if (!ready || window.isDestroyed()) return
      approvedCloses.add(window)
      window.close()
    })
  })
}

function secureWindow(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  const frame = event.senderFrame
  if (!frame) return false
  const known = [...Object.values(windows), edgeWindow, creatorWindow, settingsWindow, launcherWindow]
    .some((window) => window && !window.isDestroyed() && window.webContents === event.sender)
  return known && frame === event.sender.mainFrame && isTrustedRendererUrl(
    frame.url, path.join(currentDir, '../renderer/index.html'), process.env.ELECTRON_RENDERER_URL
  )
}

function registerIpc(store: Store<IslandSettings>) {
  const handle: typeof ipcMain.handle = (channel, listener) => ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event)) throw new Error('未授权的窗口请求')
    return listener(event, ...args)
  })
  const on = (channel: string, listener: (event: Electron.IpcMainEvent, ...args: any[]) => void) => ipcMain.on(channel, (event, ...args) => {
    if (trustedSender(event)) listener(event, ...args)
  })
  on('island:closeReady', (event, id: unknown, ready: unknown) => {
    const request = closeRequests.get(event.sender.id)
    if (request && request.id === id && event.senderFrame === event.sender.mainFrame) request.finish(ready === true)
  })
  handle('island:getSnapshot', () => snapshot())
  handle('desktopBoxes:getState', () => desktopBoxesController?.getState())
  handle('desktopBoxes:command', (_event, action: unknown) => {
    if (!desktopBoxesController) throw new Error('桌面整理尚未就绪')
    return desktopBoxesController.command(action)
  })
  handle('island:updateSettings', (_event, patch) => ({ settings: updateSettings(store, patch), settingsRevision }))
  handle('launcher:getState', () => launcherController?.getState())
  handle('launcher:discoverApps', (_event, refresh: boolean) => launcherController?.discoverInstalledApps(refresh))
  handle('launcher:addApps', (_event, candidateIds: unknown) => launcherController?.addInstalledApps(candidateIds))
  handle('launcher:pickApp', (event) => launcherController?.pickLocalApplication(BrowserWindow.fromWebContents(event.sender) ?? undefined))
  handle('launcher:addLocal', (_event, paths: unknown) => launcherController?.addLocalPaths(paths))
  handle('launcher:pickLocal', (event, mode: unknown) => launcherController?.pickLocalTargets(mode, BrowserWindow.fromWebContents(event.sender) ?? undefined))
  handle('launcher:removeLocal', (_event, id: unknown) => launcherController?.removeLocalEntry(id))
  handle('launcher:pinLocal', (_event, id: unknown, pinned: unknown) => launcherController?.pinLocalEntry(id, pinned))
  handle('launcher:search', (_event, query: unknown) => launcherController?.searchEntries(query))
  handle('launcher:launchSearch', async (_event, request: unknown) => {
    const result = await launcherController?.launchSearchItem(request)
    hideIsland()
    return result
  })
  handle('launcher:addWebsite', (_event, input: WebsiteShortcutInput) => launcherController?.addWebsite(input))
  handle('launcher:rename', (_event, input: unknown) => launcherController?.renameEntry(input))
  handle('launcher:remove', (_event, entryId: unknown) => launcherController?.removeEntry(entryId))
  handle('launcher:undoRemove', () => launcherController?.restoreRemovedEntry())
  handle('launcher:reorder', (_event, entryIds: unknown) => launcherController?.reorderEntries(entryIds))
  handle('launcher:completeSetup', () => launcherController?.completeSetup())
  handle('launcher:launch', async (_event, entryId: unknown) => {
    const result = await launcherController?.launchEntry(entryId)
    hideIsland()
    return result
  })
  handle('notifications:getState', () => notificationController?.getState())
  handle('notifications:requestAccess', () => {
    updateSettings(store, { notificationsEnabled: true, notificationOnboardingDismissed: true })
    notificationController?.requestAccess()
    return notificationController?.getState()
  })
  handle('notifications:markRead', () => notificationController?.markRead())
  handle('notifications:clear', () => notificationController?.clear())
  handle('notifications:openSettings', () => shell.openExternal('ms-settings:privacy-notifications'))
  handle('clipboardArchive:openDirectory', async () => {
    const directory = clipboardArchivePath()
    await mkdir(directory, { recursive: true })
    const error = await shell.openPath(directory)
    if (error) throw new Error(error)
  })
  handle('clipboardArchive:copyItem', (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) return false
    const item = notificationController?.getClipboardItem(id)
    if (!item) return false
    if (item.kind === 'text' && item.text !== undefined) {
      notificationController?.suppressNextClipboardEcho(item.preview)
      clipboard.writeText(item.text)
      hideIsland()
      return true
    }
    if (item.kind === 'image' && item.filePath && existsSync(item.filePath)) {
      notificationController?.suppressNextClipboardEcho(item.preview)
      clipboard.writeImage(nativeImage.createFromPath(item.filePath))
      hideIsland()
      return true
    }
    if (item.filePath && existsSync(item.filePath)) {
      shell.showItemInFolder(item.filePath)
      hideIsland()
      return true
    }
    return false
  })
  handle('clipboardArchive:clearItems', () => notificationController?.clearClipboardItems())
  handle('notifications:openSource', (_event, appId: unknown) => {
    if (typeof appId !== 'string' || !appId.trim() || appId.length > 512) return
    if (notificationController?.openSource(appId)) return
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], { detached: true, windowsHide: true })
    child.unref()
  })
  on('notifications:openPanel', (_event, view: unknown) => {
    openPanel(view === 'notifications' ? 'notifications' : view === 'clipboard' ? 'clipboard' : 'launcher')
  })
  on('island:edgeTrigger', () => {
    if (state !== 'HIDDEN' || notificationVisible || quitStarted) return
    const secondaryVisible = Boolean(creatorWindow?.isVisible() || settingsWindow?.isVisible() || launcherWindow?.isVisible())
    const fullscreenActive = notificationController?.getState().suppression === 'fullscreen'
    if (secondaryVisible || fullscreenActive) return
    activeDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    pointerEnteredIsland = true
    surfaceOutsideSince = null
    revealCompact()
  })
  on('notifications:hovered', (_event, hovered: boolean) => setNotificationHovered(Boolean(hovered)))
  on('launcher:openManager', () => void openLauncherWindow())
  on('island:setExpanded', (_event, expanded: boolean) => setExpanded(expanded))
  on('creator:open', () => {
    hideNotificationPreview()
    void openCreatorWindow()
  })
  on('settings:open', () => {
    hideNotificationPreview()
    void openSettingsWindow()
  })
}

function rendererUrl(surface: IslandSurface | 'island' | 'edge' | 'creator' | 'settings' | 'launcher') {
  const url = new URL(process.env.ELECTRON_RENDERER_URL as string)
  url.searchParams.set('surface', surface)
  return url.toString()
}

// Win11 多虚拟桌面与多显示器感知：将普通管理窗口居中于鼠标所在屏幕并拉取到当前活跃虚拟桌面。
function placeWindowOnActiveWorkspace(window: BrowserWindow, width?: number, height?: number) {
  if (typeof screen === 'undefined') return
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const bounds = window.getBounds?.() ?? { width: width ?? 800, height: height ?? 600 }
  const w = Math.min(width ?? bounds.width, area.width)
  const h = Math.min(height ?? bounds.height, area.height)
  window.setBounds?.({
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + (area.height - h) / 2),
    width: w,
    height: h
  })
  window.setVisibleOnAllWorkspaces?.(true)
  if (!window.isVisible()) window.show()
  window.setVisibleOnAllWorkspaces?.(false)
  window.moveTop?.()
  window.focus()
}

async function openLauncherWindow() {
  hideIsland()
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    if (typeof placeWindowOnActiveWorkspace === 'function') placeWindowOnActiveWorkspace(launcherWindow)
    else {
      if (!launcherWindow.isVisible()) launcherWindow.show()
      launcherWindow.focus()
    }
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
    ...(process.platform === 'win32' ? {
      backgroundMaterial: 'mica' as const,
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#00000000', symbolColor: '#f3f5f7', height: 34 }
    } : {}),
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  launcherWindow = window
  secureWindow(window)
  window.on('close', () => launcherController?.completeSetup())
  window.on('closed', () => {
    if (launcherWindow === window) launcherWindow = null
    if (typeof syncEdgeWindowVisibility === 'function') syncEdgeWindowVisibility()
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      if (typeof placeWindowOnActiveWorkspace === 'function') placeWindowOnActiveWorkspace(window, 880, 640)
      else window.show()
      if (typeof syncEdgeWindowVisibility === 'function') syncEdgeWindowVisibility()
    }
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

function bindCreatorWindowInteraction(window: BrowserWindow) {
  if (process.platform !== 'win32') return
  let active = false
  let closed = false
  const send = (next: boolean) => {
    if (closed || next === active) return
    active = next
    if (!window.webContents.isDestroyed()) window.webContents.send('creator:windowInteraction', active)
  }
  window.hookWindowMessage(0x0231, () => send(true))
  window.hookWindowMessage(0x0232, () => send(false))
  window.once('closed', () => {
    closed = true
  })
}

async function openCreatorWindow() {
  hideIsland()
  if (creatorWindow && !creatorWindow.isDestroyed()) {
    if (typeof placeWindowOnActiveWorkspace === 'function') placeWindowOnActiveWorkspace(creatorWindow)
    else {
      if (!creatorWindow.isVisible()) creatorWindow.show()
      creatorWindow.focus()
    }
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
    ...(process.platform === 'win32' ? {
      backgroundMaterial: 'mica' as const,
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#00000000', symbolColor: '#f3f5f7', height: 34 }
    } : {}),
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  creatorWindow = window
  secureWindow(window)
  bindCreatorWindowInteraction(window)
  protectWindowClose(window)
  window.on('closed', () => {
    if (creatorWindow === window) creatorWindow = null
    if (typeof syncEdgeWindowVisibility === 'function') syncEdgeWindowVisibility()
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      if (typeof placeWindowOnActiveWorkspace === 'function') placeWindowOnActiveWorkspace(window, 980, 680)
      else window.show()
      if (typeof syncEdgeWindowVisibility === 'function') syncEdgeWindowVisibility()
    }
  })
  window.webContents.on('did-finish-load', () => {
    if (!window.webContents.isDestroyed()) window.webContents.send('island:snapshot', snapshot())
  })

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl('creator'))
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'), { query: { surface: 'creator' } })
}

async function openSettingsWindow() {
  hideIsland()
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (typeof placeWindowOnActiveWorkspace === 'function') placeWindowOnActiveWorkspace(settingsWindow)
    else {
      if (!settingsWindow.isVisible()) settingsWindow.show()
      settingsWindow.focus()
    }
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
    ...(process.platform === 'win32' ? {
      backgroundMaterial: 'mica' as const,
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#00000000', symbolColor: '#f3f5f7', height: 34 }
    } : {}),
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  settingsWindow = window
  secureWindow(window)
  protectWindowClose(window)
  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null
    if (typeof syncEdgeWindowVisibility === 'function') syncEdgeWindowVisibility()
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      if (typeof placeWindowOnActiveWorkspace === 'function') placeWindowOnActiveWorkspace(window, 560, 720)
      else window.show()
      if (typeof syncEdgeWindowVisibility === 'function') syncEdgeWindowVisibility()
    }
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
    roundedCorners: false,
    backgroundColor: '#00000000',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  windows[surface] = window
  secureWindow(window)
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Mouse forwarding on hidden windows can disturb native dragging of other windows on Windows.
  window.setIgnoreMouseEvents(true)
  window.on('closed', () => {
    if (windows[surface] === window) windows[surface] = null
    if (!windows.compact && !windows.panel) {
      cleanupTimers()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl(surface))
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'), { query: { surface } })
}

async function createEdgeWindow() {
  const bounds = topEdgeBounds(targetDisplay(), settings.position)
  const window = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: 2,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  edgeWindow = window
  secureWindow(window)
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('closed', () => {
    if (edgeWindow === window) edgeWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl('edge'))
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'), { query: { surface: 'edge' } })
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('流屿桌面 · 点击胶囊展开')
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
    settingsStore = createSafeStore(
      path.join(legacyUserDataPath, 'settings.json'),
      () => new Store<IslandSettings>({ name: 'settings', defaults: defaultSettings }),
      recoveryBackups
    )
    const bridgeBinaryPath = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'NotificationBridge.exe')
      : path.join(currentDir, '../../build/generated/native/NotificationBridge.exe')
    const sharedDesktopBoxesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'SmartDeskBox.DesktopApp.exe')
      : path.join(currentDir, '../../build/generated/native/SmartDeskBox.DesktopApp.exe')
    const legacyDevDesktopBoxesPath = path.join(currentDir, '../../build/generated/desktop-boxes/SmartDeskBox.DesktopApp.exe')
    const desktopBoxesBinaryPath = !app.isPackaged && !existsSync(sharedDesktopBoxesPath) && existsSync(legacyDevDesktopBoxesPath)
      ? legacyDevDesktopBoxesPath
      : sharedDesktopBoxesPath

    const launcherStore = createSafeStore(
      path.join(legacyUserDataPath, 'launcher.json'),
      () => createLauncherStore(),
      recoveryBackups
    )
    launcherController = new LauncherController(
      launcherStore,
      broadcastLauncherState,
      path.join(legacyUserDataPath, 'installed-apps-cache.json'),
      bridgeBinaryPath
    )
    loadSettings(settingsStore)
    const desktopBoxesStore = createSafeStore(
      path.join(legacyUserDataPath, 'desktop-boxes.json'),
      () => new Store<{ enabled: boolean }>({ name: 'desktop-boxes', defaults: { enabled: false } }),
      recoveryBackups
    )
    desktopBoxesController = new DesktopBoxesController({
      executablePath: desktopBoxesBinaryPath,
      dataPath: path.join(app.getPath('userData'), 'desktop-boxes'),
      enabled: desktopBoxesStore.get('enabled') === true,
      accent: themeAccents[settings.theme],
      onEnabledChange: enabled => desktopBoxesStore.set('enabled', enabled),
      onState: broadcastDesktopBoxesState,
      onLog: message => log(`桌面整理日志: ${message}`, 'warn')
    })
    notificationController = new NotificationController({
      bridgePath: bridgeBinaryPath,
      clipboardArchivePath,
      settings: () => settings,
      onState: value => {
        broadcastNotificationState(value)
        syncEdgeWindowVisibility()
      },
      onNotification: showNotificationPreview,
      onLog: message => log(`通知桥接日志: ${message}`, 'warn')
    })
    registerIpc(settingsStore)
    await Promise.all([...surfaces.map(createSurfaceWindow), createEdgeWindow()])
    activeIslandWindow()?.on('blur', () => {
      if (state === 'EXPANDED' && !quitStarted && !notificationVisible) hideIsland()
    })
    syncSurfaceWindows()
    notificationController.configure()
    registerGlobalShortcut()
    createTray()
    void desktopBoxesController.restore().catch((error: unknown) => {
      dialog.showErrorBox('桌面整理未能恢复', error instanceof Error ? error.message : '请从桌面整理入口重试')
    })
    if (launcherController.recoveryBackupPath) recoveryBackups.push(launcherController.recoveryBackupPath)
    if (recoveryBackups.length) {
      void dialog.showMessageBox({
        type: 'warning', title: '配置已恢复',
        message: '已保留有效配置，并为异常配置创建原始备份。',
        detail: `无效字段已恢复为默认值，无效入口保留在备份中。备份位置：\n${recoveryBackups.join('\n')}`
      })
    }
    if (!launcherController.getState().setupCompleted) await openLauncherWindow()
    const scheduleClockTick = () => {
      const delay = 60_000 - (Date.now() % 60_000) + 50
      clockTimer = setTimeout(() => {
        const visible = state !== 'HIDDEN' || notificationVisible || [creatorWindow, settingsWindow, launcherWindow].some(
          window => window && !window.isDestroyed() && window.isVisible()
        )
        if (visible) broadcastSnapshot(false)
        scheduleClockTick()
      }, delay)
    }
    scheduleClockTick()
    screen.on('display-added', positionWindows)
    screen.on('display-removed', positionWindows)
    screen.on('display-metrics-changed', positionWindows)
  }).catch((error: unknown) => {
    dialog.showErrorBox('启动失败', `请检查磁盘空间、配置目录权限及应用安装。\n${error instanceof Error ? error.message : '无法启动应用'}`)
    app.quit()
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
  void (async () => {
    const editors = [creatorWindow, settingsWindow].filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()))
    if ((await Promise.all(editors.map(prepareWindowClose))).some((ready) => !ready)) {
      quitStarted = false
      return
    }
    try { await desktopBoxesController?.shutdown() }
    catch (error) {
      quitStarted = false
      await dialog.showMessageBox({
        type: 'warning', title: '桌面整理尚未退出',
        message: error instanceof Error ? error.message : '请完成当前桌面文件操作后再退出。',
        detail: '本次退出已取消，完成操作或关闭桌面整理设置后可重新退出。'
      })
      return
    }
    const closed = await notificationController?.shutdown(async () => {
      const result = await dialog.showMessageBox({
        type: 'warning', title: '仍在完成归档',
        message: '通知桥接尚未退出，可能仍在写入剪贴板归档。',
        detail: '继续等待可保护正在写入的文件。强制退出可能导致文件不完整。',
        buttons: ['继续等待', '取消退出', '强制退出'], defaultId: 0, cancelId: 1, noLink: true
      })
      return (['wait', 'cancel', 'force'] as const)[result.response]
    })
    if (closed === false) {
      notificationController?.configure()
      try { await desktopBoxesController?.restore() }
      catch (error) {
        dialog.showErrorBox('桌面整理未能恢复', error instanceof Error ? error.message : '请从桌面整理入口重试')
      }
      quitStarted = false
      return
    }
    cleanupTimers()
    tray?.destroy()
    if (typeof edgeWindow !== 'undefined') edgeWindow?.destroy()
    launcherWindow?.destroy()
    creatorWindow?.destroy()
    settingsWindow?.destroy()
    globalShortcut.unregisterAll()
    quitReady = true
    log('应用已退出')
    app.quit()
  })().catch((error: unknown) => {
    quitStarted = false
    log(`退出未完成: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
  })
})
