import { contextBridge, ipcRenderer } from 'electron'
import type { IslandSettings } from '../shared/settings'
import type { InstalledAppCandidate, LauncherState, WebsiteShortcutInput } from '../shared/launcher'
import type { NotificationCenterState } from '../shared/notifications'
import type { IslandSnapshot } from '../shared/types'

contextBridge.exposeInMainWorld('island', {
  getSnapshot: () => ipcRenderer.invoke('island:getSnapshot') as Promise<IslandSnapshot>,
  updateSettings: (patch: Partial<IslandSettings>) => ipcRenderer.invoke('island:updateSettings', patch) as Promise<IslandSettings>,
  getLauncherState: () => ipcRenderer.invoke('launcher:getState') as Promise<LauncherState>,
  discoverInstalledApps: (refresh = false) => ipcRenderer.invoke('launcher:discoverApps', refresh) as Promise<InstalledAppCandidate[]>,
  addInstalledApps: (candidateIds: string[]) => ipcRenderer.invoke('launcher:addApps', candidateIds) as Promise<LauncherState>,
  pickLocalApplication: () => ipcRenderer.invoke('launcher:pickApp') as Promise<LauncherState | null>,
  addWebsite: (input: WebsiteShortcutInput) => ipcRenderer.invoke('launcher:addWebsite', input) as Promise<LauncherState>,
  renameShortcut: (id: string, name: string) => ipcRenderer.invoke('launcher:rename', { id, name }) as Promise<LauncherState>,
  removeShortcut: (id: string) => ipcRenderer.invoke('launcher:remove', id) as Promise<LauncherState>,
  reorderShortcuts: (ids: string[]) => ipcRenderer.invoke('launcher:reorder', ids) as Promise<LauncherState>,
  launchShortcut: (id: string) => ipcRenderer.invoke('launcher:launch', id) as Promise<void>,
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
  onSnapshot: (callback: (snapshot: IslandSnapshot) => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: IslandSnapshot) => callback(snapshot)
    ipcRenderer.on('island:snapshot', listener)
    return () => ipcRenderer.off('island:snapshot', listener)
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
