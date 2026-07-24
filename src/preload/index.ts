import { contextBridge, ipcRenderer } from 'electron'
import type { IslandSettings } from '../shared/settings'
import type { InstalledAppCandidate, LauncherState, WebsiteShortcutInput } from '../shared/launcher'
import type { TriggerMovePhase, TriggerVisualLayout } from '../shared/triggerGesture'
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
  openLauncherManager: () => ipcRenderer.send('launcher:openManager'),
  setExpanded: (expanded: boolean) => ipcRenderer.send('island:setExpanded', expanded),
  setSettingsOpen: (open: boolean) => ipcRenderer.send('island:setSettingsOpen', open),
  moveTrigger: (phase: TriggerMovePhase, screenX: number) => ipcRenderer.send('island:moveTrigger', phase, screenX),
  setTriggerPull: (distance: number) => ipcRenderer.send('island:setTriggerPull', distance),
  onTriggerVisualLayout: (callback: (layout: TriggerVisualLayout) => void) => {
    const listener = (_: Electron.IpcRendererEvent, layout: TriggerVisualLayout) => callback(layout)
    ipcRenderer.on('island:triggerVisualLayout', listener)
    return () => ipcRenderer.off('island:triggerVisualLayout', listener)
  },
  onSnapshot: (callback: (snapshot: IslandSnapshot) => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: IslandSnapshot) => callback(snapshot)
    ipcRenderer.on('island:snapshot', listener)
    return () => ipcRenderer.off('island:snapshot', listener)
  },
  onLauncherState: (callback: (state: LauncherState) => void) => {
    const listener = (_: Electron.IpcRendererEvent, state: LauncherState) => callback(state)
    ipcRenderer.on('launcher:state', listener)
    return () => ipcRenderer.off('launcher:state', listener)
  }
})
