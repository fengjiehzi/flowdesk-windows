import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  bridgeEventSchema,
  filterMutedNotifications,
  markAllNotificationsRead,
  mergeNotificationItems,
  notificationSnapshotDiff,
  notificationSources,
  unreadNotificationCount,
  type BridgeNotification,
  type DesktopAdapterId,
  type DesktopNotificationAdapter,
  type NotificationAccessStatus,
  type NotificationCenterState,
  type NotificationSuppression,
  type SystemNotificationItem
} from '../shared/notifications'
import type { IslandSettings } from '../shared/settings'

type NotificationControllerOptions = {
  bridgePath: string
  clipboardArchivePath: () => string
  settings: () => IslandSettings
  onState: (state: NotificationCenterState) => void
  onNotification: () => void
}

export class NotificationController {
  private process: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private snapshotKeys: Set<string> | null = null
  private discoveredSources = new Map<string, Pick<BridgeNotification, 'appId' | 'appName' | 'icon'>>()
  private items: SystemNotificationItem[] = []
  private accessStatus: NotificationAccessStatus = 'disabled'
  private suppression: NotificationSuppression = 'unknown'
  private desktopAdapters = new Map<DesktopAdapterId, DesktopNotificationAdapter>([
    ['desktop:feishu', { id: 'desktop:feishu', name: '飞书', status: 'disabled' }],
    ['desktop:weixin', { id: 'desktop:weixin', name: '微信', status: 'disabled' }]
  ])
  private restartAvailable = true
  private shuttingDown = false

  constructor(private readonly options: NotificationControllerOptions) {}

  getState(): NotificationCenterState {
    const settings = this.options.settings()
    this.items = mergeNotificationItems(this.items, [])
    const mutedIds = settings.mutedNotificationApps.map((app) => app.id)
    const visibleItems = filterMutedNotifications(this.items, mutedIds)
    return {
      accessStatus: settings.notificationsEnabled ? this.accessStatus : 'disabled',
      enabled: settings.notificationsEnabled,
      suppression: this.suppression,
      items: visibleItems,
      unreadCount: unreadNotificationCount(visibleItems),
      sources: notificationSources(this.items, settings.mutedNotificationApps, [...this.discoveredSources.values()]),
      desktopAdapters: [...this.desktopAdapters.values()]
    }
  }

  configure() {
    const settings = this.options.settings()
    if (settings.notificationsEnabled || settings.clipboardArchiveEnabled) {
      this.start()
      this.send({ type: settings.notificationsEnabled ? 'start' : 'stop' })
      this.send({
        type: 'configure',
        desktopPopupNotificationsEnabled: settings.notificationsEnabled && settings.desktopPopupNotificationsEnabled,
        clipboardArchiveEnabled: settings.clipboardArchiveEnabled,
        clipboardArchivePath: this.options.clipboardArchivePath()
      })
    }
    else {
      this.send({
        type: 'configure',
        desktopPopupNotificationsEnabled: false,
        clipboardArchiveEnabled: false,
        clipboardArchivePath: ''
      })
      this.send({ type: 'stop' })
      this.snapshotKeys = null
      this.accessStatus = 'disabled'
      this.setDesktopAdaptersDisabled()
      this.emitState()
    }
  }

  requestAccess() {
    this.start()
    this.send({ type: 'requestAccess' })
  }

  openSource(appId: string) {
    if (appId !== 'desktop:feishu' && appId !== 'desktop:weixin') return false
    this.send({ type: 'openSource', appId })
    return true
  }

  markRead() {
    this.items = markAllNotificationsRead(this.items)
    this.emitState()
  }

  clear() {
    this.items = []
    this.emitState()
  }

  async shutdown() {
    this.shuttingDown = true
    const child = this.process
    if (!child) return
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    this.send({ type: 'shutdown' })
    await closed
  }

  private start() {
    if (this.process) return
    if (!existsSync(this.options.bridgePath)) {
      this.accessStatus = 'unavailable'
      this.emitState()
      return
    }

    this.shuttingDown = false
    this.buffer = ''
    const child = spawn(this.options.bridgePath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.process = child
    child.stderr.resume()
    child.stdin.on('error', () => {})
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(chunk))
    child.on('error', () => {
      this.accessStatus = 'error'
      this.emitState()
    })
    child.on('close', () => {
      if (this.process === child) this.process = null
      const settings = this.options.settings()
      if (this.shuttingDown || (!settings.notificationsEnabled && !settings.clipboardArchiveEnabled)) return
      if (this.restartAvailable) {
        this.restartAvailable = false
        setTimeout(() => this.start(), 1000).unref()
      } else {
        this.accessStatus = 'error'
        this.emitState()
      }
    })
    this.send({ type: 'status' })
    const settings = this.options.settings()
    this.send({ type: settings.notificationsEnabled ? 'start' : 'stop' })
    this.send({
      type: 'configure',
      desktopPopupNotificationsEnabled: settings.notificationsEnabled && settings.desktopPopupNotificationsEnabled,
      clipboardArchiveEnabled: settings.clipboardArchiveEnabled,
      clipboardArchivePath: this.options.clipboardArchivePath()
    })
  }

  private send(command:
    | { type: 'status' | 'requestAccess' | 'start' | 'stop' | 'shutdown' }
    | {
        type: 'configure'
        desktopPopupNotificationsEnabled: boolean
        clipboardArchiveEnabled: boolean
        clipboardArchivePath: string
      }
    | { type: 'openSource'; appId: DesktopAdapterId }
  ) {
    if (this.process?.stdin.writable) {
      try {
        this.process.stdin.write(`${JSON.stringify(command)}\n`)
      } catch {
        // A concurrent process exit is handled by the close listener.
      }
    }
  }

  private consume(chunk: string) {
    this.buffer += chunk
    if (this.buffer.length > 16_000_000) {
      this.buffer = ''
      this.accessStatus = 'error'
      this.emitState()
      return
    }
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) return
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      try {
        const event = bridgeEventSchema.parse(JSON.parse(line))
        if (event.type === 'ready') continue
        if (event.type === 'status') {
          const regainedAccess = this.accessStatus !== 'allowed' && event.status === 'allowed'
          this.accessStatus = event.status
          if (regainedAccess) this.snapshotKeys = null
        }
        if (event.type === 'suppression') this.suppression = event.state
        if (event.type === 'snapshot') this.ingest(event.notifications)
        if (event.type === 'desktopNotification') this.ingestDirect(event.notification)
        if (event.type === 'desktopAdapterStatus') this.desktopAdapters.set(event.adapter.id, event.adapter)
        if (event.type === 'clipboardArchiveError') {
          console.error('Clipboard archive error:', event.message)
          continue
        }
        if (event.type === 'error') this.accessStatus = 'error'
        this.emitState()
      } catch {
        this.accessStatus = 'error'
        this.emitState()
      }
    }
  }

  private ingest(snapshot: BridgeNotification[]) {
    for (const item of snapshot) {
      this.discoveredSources.set(item.appId, { appId: item.appId, appName: item.appName, icon: item.icon })
    }
    const diff = notificationSnapshotDiff(this.snapshotKeys, snapshot)
    this.snapshotKeys = diff.keys
    const incoming = filterMutedNotifications(diff.incoming, this.options.settings().mutedNotificationApps.map((app) => app.id))
    if (!incoming.length) return
    this.items = mergeNotificationItems(this.items, incoming)
    this.options.onNotification()
  }

  private ingestDirect(item: BridgeNotification) {
    this.discoveredSources.set(item.appId, { appId: item.appId, appName: item.appName, icon: item.icon })
    if (!filterMutedNotifications([item], this.options.settings().mutedNotificationApps.map((app) => app.id)).length) return
    this.items = mergeNotificationItems(this.items, [item])
    this.options.onNotification()
  }

  private setDesktopAdaptersDisabled() {
    for (const adapter of this.desktopAdapters.values()) {
      this.desktopAdapters.set(adapter.id, { ...adapter, status: 'disabled' })
    }
  }

  private emitState() {
    this.options.onState(this.getState())
  }
}
