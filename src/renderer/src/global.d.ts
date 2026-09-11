import type { IslandSettings } from '../../shared/settings'
import type { InstalledAppCandidate, LauncherState, WebsiteShortcutInput } from '../../shared/launcher'
import type { NotificationCenterState } from '../../shared/notifications'
import type { IslandSnapshot } from '../../shared/types'

declare global {
  interface Window {
    island?: {
      getSnapshot: () => Promise<IslandSnapshot>
      updateSettings: (patch: Partial<IslandSettings>) => Promise<IslandSettings>
      getLauncherState: () => Promise<LauncherState>
      discoverInstalledApps: (refresh?: boolean) => Promise<InstalledAppCandidate[]>
      addInstalledApps: (candidateIds: string[]) => Promise<LauncherState>
      pickLocalApplication: () => Promise<LauncherState | null>
      addWebsite: (input: WebsiteShortcutInput) => Promise<LauncherState>
      renameShortcut: (id: string, name: string) => Promise<LauncherState>
      removeShortcut: (id: string) => Promise<LauncherState>
      reorderShortcuts: (ids: string[]) => Promise<LauncherState>
      launchShortcut: (id: string) => Promise<void>
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
      openSettings: () => void
      onSnapshot: (callback: (snapshot: IslandSnapshot) => void) => () => void
      onLauncherState: (callback: (state: LauncherState) => void) => () => void
      onNotificationState: (callback: (state: NotificationCenterState) => void) => () => void
      onPanelView: (callback: (view: 'launcher' | 'notifications') => void) => () => void
    }
  }
}

export {}
