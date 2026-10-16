import type { IslandSettingsPatch } from '../../shared/settings'
import type { InstalledAppCandidate, LauncherState, WebsiteShortcutInput, LauncherSearchItem, LauncherSearchRequest, LauncherLaunchResult } from '../../shared/launcher'
import type { NotificationCenterState } from '../../shared/notifications'
import type { IslandSnapshot, SettingsUpdateResult } from '../../shared/types'
import type { DesktopBoxesAction, DesktopBoxesState } from '../../shared/desktopBoxes'

declare global {
  interface Window {
    island?: {
      getDesktopBoxesState: () => Promise<DesktopBoxesState>
      desktopBoxesCommand: (action: Exclude<DesktopBoxesAction, 'exit'>) => Promise<DesktopBoxesState>
      onDesktopBoxesState: (callback: (state: DesktopBoxesState) => void) => () => void
      getSnapshot: () => Promise<IslandSnapshot>
      updateSettings: (patch: IslandSettingsPatch) => Promise<SettingsUpdateResult>
      getLauncherState: () => Promise<LauncherState>
      discoverInstalledApps: (refresh?: boolean) => Promise<InstalledAppCandidate[]>
      addInstalledApps: (candidateIds: string[]) => Promise<LauncherState>
      pickLocalApplication: () => Promise<LauncherState | null>
      registerLocalPaths: (paths: string[]) => Promise<LauncherState>
      registerDroppedFiles: (files: File[]) => Promise<LauncherState>
      pickLocalTargets: (mode: 'files' | 'folder') => Promise<LauncherState | null>
      removeLocalLaunch: (id: string) => Promise<LauncherState>
      pinLocalLaunch: (id: string, pinned: boolean) => Promise<LauncherState>
      searchLaunchItems: (query: string) => Promise<LauncherSearchItem[]>
      launchSearchItem: (request: LauncherSearchRequest) => Promise<LauncherLaunchResult>
      addWebsite: (input: WebsiteShortcutInput) => Promise<LauncherState>
      renameShortcut: (id: string, name: string) => Promise<LauncherState>
      removeShortcut: (id: string) => Promise<LauncherState>
      undoRemoveShortcut: () => Promise<LauncherState>
      reorderShortcuts: (ids: string[]) => Promise<LauncherState>
      launchShortcut: (id: string) => Promise<LauncherLaunchResult>
      completeLauncherSetup: () => Promise<LauncherState>
      getNotificationState: () => Promise<NotificationCenterState>
      requestNotificationAccess: () => Promise<NotificationCenterState>
      markNotificationsRead: () => Promise<void>
      clearNotificationHistory: () => Promise<void>
      openNotificationSettings: () => Promise<void>
      openClipboardArchiveDirectory: () => Promise<void>
      openNotificationSource: (appId: string) => Promise<void>
      openPanel: (view: 'launcher' | 'notifications') => void
      setNotificationPreviewHovered: (hovered: boolean) => void
      openLauncherManager: () => void
      setExpanded: (expanded: boolean) => void
      openCreator: () => void
      onCreatorWindowInteraction: (callback: (active: boolean) => void) => () => void
      openSettings: () => void
      onSnapshot: (callback: (snapshot: IslandSnapshot) => void) => () => void
      onPrepareClose: (callback: () => Promise<boolean>) => () => void
      onLauncherState: (callback: (state: LauncherState) => void) => () => void
      onNotificationState: (callback: (state: NotificationCenterState) => void) => () => void
      onPanelView: (callback: (view: 'launcher' | 'notifications') => void) => () => void
    }
  }
}

export {}
