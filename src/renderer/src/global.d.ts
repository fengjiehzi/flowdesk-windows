import type { IslandSettings } from '../../shared/settings'
import type { InstalledAppCandidate, LauncherState, WebsiteShortcutInput } from '../../shared/launcher'
import type { IslandSnapshot } from '../../shared/types'
import type { TriggerMovePhase, TriggerVisualLayout } from '../../shared/triggerGesture'

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
      openLauncherManager: () => void
      setExpanded: (expanded: boolean) => void
      setSettingsOpen: (open: boolean) => void
      moveTrigger: (phase: TriggerMovePhase, screenX: number) => void
      setTriggerPull: (distance: number) => void
      onTriggerVisualLayout: (callback: (layout: TriggerVisualLayout) => void) => () => void
      onSnapshot: (callback: (snapshot: IslandSnapshot) => void) => () => void
      onLauncherState: (callback: (state: LauncherState) => void) => () => void
    }
  }
}

export {}
