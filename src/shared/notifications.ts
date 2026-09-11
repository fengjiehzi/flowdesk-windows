import { z } from 'zod'

export const notificationAccessStatusSchema = z.enum(['disabled', 'unavailable', 'unspecified', 'allowed', 'denied', 'error'])
export const notificationSuppressionSchema = z.enum(['accepts', 'locked', 'busy', 'fullscreen', 'presentation', 'quiet', 'unknown'])
export const desktopAdapterIdSchema = z.enum(['desktop:feishu', 'desktop:weixin'])
export const desktopAdapterStatusSchema = z.enum([
  'disabled',
  'app-not-running',
  'waiting',
  'capturing',
  'integrity-mismatch',
  'error'
])

export const mutedNotificationAppSchema = z.object({
  id: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1).max(128)
})

export const bridgeNotificationSchema = z.object({
  platformId: z.number().int().min(0).max(0xffffffff),
  appId: z.string().trim().min(1).max(512),
  appName: z.string().trim().min(1).max(128),
  icon: z.string().startsWith('data:image/png;base64,').max(130_000).nullish().transform((icon) => icon ?? undefined),
  title: z.string().max(256).default(''),
  body: z.string().max(2048).default(''),
  createdAt: z.string().datetime()
})

export const systemNotificationItemSchema = bridgeNotificationSchema.extend({
  id: z.string().min(1).max(1024),
  groupCount: z.number().int().min(1).max(999).default(1),
  unreadCount: z.number().int().min(0).max(999).default(1)
})

export const notificationSourceSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().min(1).max(128),
  icon: z.string().startsWith('data:image/png;base64,').max(130_000).optional(),
  muted: z.boolean()
})

export const desktopNotificationAdapterSchema = z.object({
  id: desktopAdapterIdSchema,
  name: z.string().min(1).max(32),
  status: desktopAdapterStatusSchema
})

export const notificationCenterStateSchema = z.object({
  accessStatus: notificationAccessStatusSchema,
  enabled: z.boolean(),
  suppression: notificationSuppressionSchema,
  items: z.array(systemNotificationItemSchema).max(100),
  unreadCount: z.number().int().min(0).max(99_900),
  sources: z.array(notificationSourceSchema).max(100),
  desktopAdapters: z.array(desktopNotificationAdapterSchema).max(2)
})

export const bridgeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('status'), status: notificationAccessStatusSchema }),
  z.object({ type: z.literal('snapshot'), notifications: z.array(bridgeNotificationSchema).max(100) }),
  z.object({ type: z.literal('desktopNotification'), notification: bridgeNotificationSchema }),
  z.object({
    type: z.literal('desktopAdapterStatus'),
    adapter: desktopNotificationAdapterSchema
  }),
  z.object({ type: z.literal('suppression'), state: notificationSuppressionSchema }),
  z.object({ type: z.literal('clipboardArchiveError'), message: z.string().max(500) }),
  z.object({ type: z.literal('error'), message: z.string().max(500) })
])

export type NotificationAccessStatus = z.infer<typeof notificationAccessStatusSchema>
export type NotificationSuppression = z.infer<typeof notificationSuppressionSchema>
export type DesktopAdapterId = z.infer<typeof desktopAdapterIdSchema>
export type DesktopNotificationAdapter = z.infer<typeof desktopNotificationAdapterSchema>
export type MutedNotificationApp = z.infer<typeof mutedNotificationAppSchema>
export type BridgeNotification = z.infer<typeof bridgeNotificationSchema>
export type SystemNotificationItem = z.infer<typeof systemNotificationItemSchema>
export type NotificationSource = z.infer<typeof notificationSourceSchema>
export type NotificationCenterState = z.infer<typeof notificationCenterStateSchema>

export const notificationHistoryLimit = 100
export const notificationHistoryMs = 24 * 60 * 60 * 1000
export const notificationGroupWindowMs = 5000
export const notificationPreviewMs = 4000
export const notificationPreviewMaxMs = 10_000

export function notificationKey(item: BridgeNotification) {
  return `${item.appId}\u0000${item.platformId}\u0000${item.createdAt}`
}

export function nextNotificationPreviewDeadline(startedAt: number, now: number) {
  return Math.min(now + notificationPreviewMs, startedAt + notificationPreviewMaxMs)
}

export function notificationSnapshotDiff(previous: Set<string> | null, snapshot: BridgeNotification[]) {
  const keys = new Set(snapshot.map(notificationKey))
  return {
    keys,
    incoming: previous === null ? [] : snapshot.filter((item) => !previous.has(notificationKey(item)))
  }
}

export function filterMutedNotifications<T extends Pick<BridgeNotification, 'appId'>>(
  items: readonly T[],
  mutedAppIds: Iterable<string>
): T[] {
  const muted = new Set(mutedAppIds)
  return items.filter((item) => !muted.has(item.appId))
}

export function mergeNotificationItems(
  current: SystemNotificationItem[],
  incoming: BridgeNotification[],
  now = Date.now()
) {
  const cutoff = now - notificationHistoryMs
  let items = current
    .filter((item) => Date.parse(item.createdAt) >= cutoff)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))

  for (const notification of [...incoming].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))) {
    const id = notificationKey(notification)
    if (items.some((item) => item.id === id)) continue
    const newest = items[0]
    // ponytail: title-based grouping; replace with app-provided conversation IDs if Windows exposes them later.
    if (
      newest
      && newest.appId === notification.appId
      && newest.title === notification.title
      && Date.parse(notification.createdAt) - Date.parse(newest.createdAt) >= 0
      && Date.parse(notification.createdAt) - Date.parse(newest.createdAt) <= notificationGroupWindowMs
    ) {
      items = [{
        ...notification,
        id,
        groupCount: Math.min(999, newest.groupCount + 1),
        unreadCount: Math.min(999, newest.unreadCount + 1)
      }, ...items.slice(1)]
    } else {
      items = [{ ...notification, id, groupCount: 1, unreadCount: 1 }, ...items]
    }
  }

  return items
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, notificationHistoryLimit)
}

export function notificationSources(
  items: SystemNotificationItem[],
  mutedApps: MutedNotificationApp[],
  discovered: Array<Pick<BridgeNotification, 'appId' | 'appName' | 'icon'>> = []
): NotificationSource[] {
  const sources = new Map<string, NotificationSource>()
  for (const app of mutedApps) sources.set(app.id, { ...app, muted: true })
  for (const item of [...discovered, ...items]) {
    const existing = sources.get(item.appId)
    sources.set(item.appId, {
      id: item.appId,
      name: item.appName,
      icon: item.icon ?? existing?.icon,
      muted: existing?.muted ?? false
    })
  }
  return [...sources.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')).slice(0, 100)
}

export function unreadNotificationCount(items: SystemNotificationItem[]) {
  return items.reduce((total, item) => total + item.unreadCount, 0)
}

export function markAllNotificationsRead(items: SystemNotificationItem[]) {
  return items.map((item) => ({ ...item, unreadCount: 0 }))
}
