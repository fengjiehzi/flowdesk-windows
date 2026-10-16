import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IslandSettingsPatch } from '../shared/settings'
import type { InstalledAppCandidate, LauncherState, WebsiteShortcutInput, LauncherSearchItem, LauncherSearchRequest, LauncherLaunchResult } from '../shared/launcher'
import type { NotificationCenterState } from '../shared/notifications'
import type { IslandSnapshot, SettingsUpdateResult } from '../shared/types'
import type { DesktopBoxesAction, DesktopBoxesState } from '../shared/desktopBoxes'

contextBridge.exposeInMainWorld('island', {
  getDesktopBoxesState: () => ipcRenderer.invoke('desktopBoxes:getState') as Promise<DesktopBoxesState>,
  desktopBoxesCommand: (action: Exclude<DesktopBoxesAction, 'exit'>) => ipcRenderer.invoke('desktopBoxes:command', action) as Promise<DesktopBoxesState>,
  onDesktopBoxesState: (callback: (state: DesktopBoxesState) => void) => {
    const listener = (_: Electron.IpcRendererEvent, state: DesktopBoxesState) => callback(state)
    ipcRenderer.on('desktopBoxes:state', listener)
    return () => ipcRenderer.off('desktopBoxes:state', listener)
  },
  getSnapshot: () => ipcRenderer.invoke('island:getSnapshot') as Promise<IslandSnapshot>,
  updateSettings: (patch: IslandSettingsPatch) => ipcRenderer.invoke('island:updateSettings', patch) as Promise<SettingsUpdateResult>,
  getLauncherState: () => ipcRenderer.invoke('launcher:getState') as Promise<LauncherState>,
  discoverInstalledApps: (refresh = false) => ipcRenderer.invoke('launcher:discoverApps', refresh) as Promise<InstalledAppCandidate[]>,
  addInstalledApps: (candidateIds: string[]) => ipcRenderer.invoke('launcher:addApps', candidateIds) as Promise<LauncherState>,
  pickLocalApplication: () => ipcRenderer.invoke('launcher:pickApp') as Promise<LauncherState | null>,
  registerLocalPaths: (paths: string[]) => ipcRenderer.invoke('launcher:addLocal', paths) as Promise<LauncherState>,
  registerDroppedFiles: (files: File[]) => {
    const paths = files.map(file => webUtils.getPathForFile(file)).filter(Boolean)
    if (!paths.length) return Promise.reject(new Error('未取得本地文件路径，请拖入磁盘上的文件或文件夹'))
    return ipcRenderer.invoke('launcher:addLocal', paths) as Promise<LauncherState>
  },
  pickLocalTargets: (mode: 'files' | 'folder') => ipcRenderer.invoke('launcher:pickLocal', mode) as Promise<LauncherState | null>,
  removeLocalLaunch: (id: string) => ipcRenderer.invoke('launcher:removeLocal', id) as Promise<LauncherState>,
  pinLocalLaunch: (id: string, pinned: boolean) => ipcRenderer.invoke('launcher:pinLocal', id, pinned) as Promise<LauncherState>,
  searchLaunchItems: (query: string) => ipcRenderer.invoke('launcher:search', query) as Promise<LauncherSearchItem[]>,
  launchSearchItem: (request: LauncherSearchRequest) => ipcRenderer.invoke('launcher:launchSearch', request) as Promise<LauncherLaunchResult>,
  addWebsite: (input: WebsiteShortcutInput) => ipcRenderer.invoke('launcher:addWebsite', input) as Promise<LauncherState>,
  renameShortcut: (id: string, name: string) => ipcRenderer.invoke('launcher:rename', { id, name }) as Promise<LauncherState>,
  removeShortcut: (id: string) => ipcRenderer.invoke('launcher:remove', id) as Promise<LauncherState>,
  undoRemoveShortcut: () => ipcRenderer.invoke('launcher:undoRemove') as Promise<LauncherState>,
  reorderShortcuts: (ids: string[]) => ipcRenderer.invoke('launcher:reorder', ids) as Promise<LauncherState>,
  launchShortcut: (id: string) => ipcRenderer.invoke('launcher:launch', id) as Promise<LauncherLaunchResult>,
  completeLauncherSetup: () => ipcRenderer.invoke('launcher:completeSetup') as Promise<LauncherState>,
  getNotificationState: () => ipcRenderer.invoke('notifications:getState') as Promise<NotificationCenterState>,
  requestNotificationAccess: () => ipcRenderer.invoke('notifications:requestAccess') as Promise<NotificationCenterState>,
  markNotificationsRead: () => ipcRenderer.invoke('notifications:markRead') as Promise<void>,
  clearNotificationHistory: () => ipcRenderer.invoke('notifications:clear') as Promise<void>,
  openNotificationSettings: () => ipcRenderer.invoke('notifications:openSettings') as Promise<void>,
  openClipboardArchiveDirectory: () => ipcRenderer.invoke('clipboardArchive:openDirectory') as Promise<void>,
  openNotificationSource: (appId: string) => ipcRenderer.invoke('notifications:openSource', appId) as Promise<void>,
  openPanel: (view: 'launcher' | 'notifications') => ipcRenderer.send('notifications:openPanel', view),
  setNotificationPreviewHovered: (hovered: boolean) => ipcRenderer.send('notifications:hovered', hovered),
  openLauncherManager: () => ipcRenderer.send('launcher:openManager'),
  setExpanded: (expanded: boolean) => ipcRenderer.send('island:setExpanded', expanded),
  openCreator: () => ipcRenderer.send('creator:open'),
  onCreatorWindowInteraction: (callback: (active: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, active: boolean) => callback(active)
    ipcRenderer.on('creator:windowInteraction', listener)
    return () => ipcRenderer.off('creator:windowInteraction', listener)
  },
  openSettings: () => ipcRenderer.send('settings:open'),
  onSnapshot: (callback: (snapshot: IslandSnapshot) => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: IslandSnapshot) => callback(snapshot)
    ipcRenderer.on('island:snapshot', listener)
    return () => ipcRenderer.off('island:snapshot', listener)
  },
  onPrepareClose: (callback: () => Promise<boolean>) => {
    const listener = async (_: Electron.IpcRendererEvent, id: number) => {
      try { ipcRenderer.send('island:closeReady', id, await callback()) }
      catch { ipcRenderer.send('island:closeReady', id, false) }
    }
    ipcRenderer.on('island:prepareClose', listener)
    return () => ipcRenderer.off('island:prepareClose', listener)
  },
  onLauncherState: (callback: (state: LauncherState) => void) => {
    const listener = (_: Electron.IpcRendererEvent, state: LauncherState) => callback(state)
    ipcRenderer.on('launcher:state', listener)
    return () => ipcRenderer.off('launcher:state', listener)
  },
  onNotificationState: (callback: (state: NotificationCenterState) => void) => {
    const listener = (_: Electron.IpcRendererEvent, state: NotificationCenterState) => callback(state)
    ipcRenderer.on('notifications:state', listener)
    return () => ipcRenderer.off('notifications:state', listener)
  },
  onPanelView: (callback: (view: 'launcher' | 'notifications') => void) => {
    const listener = (_: Electron.IpcRendererEvent, view: 'launcher' | 'notifications') => callback(view)
    ipcRenderer.on('island:panelView', listener)
    return () => ipcRenderer.off('island:panelView', listener)
  }
})
