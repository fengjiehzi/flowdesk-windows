import assert from 'node:assert/strict'
import {
  bridgeEventSchema,
  filterMutedNotifications,
  markAllNotificationsRead,
  mergeNotificationItems,
  notificationHistoryMs,
  notificationKey,
  nextNotificationPreviewDeadline,
  notificationSnapshotDiff,
  notificationSources,
  unreadNotificationCount,
  type BridgeNotification
} from './notifications'

const now = Date.parse('2026-07-25T08:00:00.000Z')
const notification = (patch: Partial<BridgeNotification> = {}): BridgeNotification => ({
  platformId: 1,
  appId: 'com.example.chat',
  appName: '示例聊天',
  title: '项目群',
  body: '第一条消息',
  createdAt: new Date(now - 2000).toISOString(),
  ...patch
})

const first = notification()
assert.equal(notificationKey(first), `com.example.chat\u00001\u0000${first.createdAt}`)
assert.equal(nextNotificationPreviewDeadline(1000, 2000), 6000)
assert.equal(nextNotificationPreviewDeadline(1000, 9000), 11000)
assert.equal(bridgeEventSchema.safeParse({ type: 'snapshot', notifications: [first] }).success, true)
assert.equal(bridgeEventSchema.safeParse({ type: 'snapshot', notifications: [{ ...first, body: 'x'.repeat(2049) }] }).success, false)
const nullIcon = bridgeEventSchema.parse({ type: 'snapshot', notifications: [{ ...first, icon: null }] })
assert.equal(nullIcon.type, 'snapshot')
if (nullIcon.type !== 'snapshot') throw new Error('Snapshot parsing failed')
assert.equal(nullIcon.notifications[0]?.icon, undefined)
assert.equal(bridgeEventSchema.safeParse({
  type: 'desktopAdapterStatus',
  adapter: { id: 'desktop:feishu', name: '飞书', status: 'waiting' }
}).success, true)
assert.equal(bridgeEventSchema.safeParse({
  type: 'desktopNotification',
  notification: { ...first, appId: 'desktop:feishu', appName: '飞书' }
}).success, true)
assert.equal(bridgeEventSchema.safeParse({
  type: 'clipboardArchiveError',
  message: 'clipboard unavailable'
}).success, true)

const baseline = notificationSnapshotDiff(null, [first])
assert.deepEqual(baseline.incoming, [])
const nextSnapshot = notificationSnapshotDiff(baseline.keys, [first, notification({ platformId: 2 })])
assert.equal(nextSnapshot.incoming.length, 1)
assert.deepEqual(filterMutedNotifications(nextSnapshot.incoming, ['com.example.chat']), [])

const grouped = mergeNotificationItems([], [
  first,
  notification({ platformId: 2, body: '第二条消息', createdAt: new Date(now).toISOString() })
], now)
assert.equal(grouped.length, 1)
assert.equal(grouped[0]?.groupCount, 2)
assert.equal(grouped[0]?.unreadCount, 2)
assert.equal(grouped[0]?.body, '第二条消息')
assert.equal(unreadNotificationCount(grouped), 2)
const read = markAllNotificationsRead(grouped)
assert.equal(read[0]?.unreadCount, 0)
assert.equal(unreadNotificationCount(read), 0)
assert.equal(mergeNotificationItems(grouped, [grouped[0]], now).length, 1)

const regrouped = mergeNotificationItems(read, [
  notification({ platformId: 4, body: '第三条消息', createdAt: new Date(now + 1000).toISOString() })
], now + 1000)
assert.equal(regrouped[0]?.groupCount, 3)
assert.equal(regrouped[0]?.unreadCount, 1)
assert.equal(unreadNotificationCount(regrouped), 1)

const separate = mergeNotificationItems(grouped, [
  notification({ platformId: 3, title: '另一会话', createdAt: new Date(now + 1000).toISOString() })
], now + 1000)
assert.equal(separate.length, 2)

const delayed = mergeNotificationItems(grouped, [
  notification({ platformId: 5, title: '延迟通知', createdAt: new Date(now - 1000).toISOString() })
], now)
assert.equal(delayed[0]?.createdAt, new Date(now).toISOString())

const expired = mergeNotificationItems([
  {
    ...notification({ createdAt: new Date(now - notificationHistoryMs - 1).toISOString() }),
    id: 'expired',
    groupCount: 1,
    unreadCount: 1
  }
], [], now)
assert.deepEqual(expired, [])

const sources = notificationSources(separate, [{ id: 'muted.app', name: '静音应用' }])
assert.equal(sources.find((source) => source.id === 'muted.app')?.muted, true)
assert.equal(sources.find((source) => source.id === 'com.example.chat')?.muted, false)

const limited = mergeNotificationItems([], Array.from({ length: 110 }, (_, index) => notification({
  platformId: index,
  title: `会话 ${index}`,
  createdAt: new Date(now + index * 10).toISOString()
})), now + 2000)
assert.equal(limited.length, 100)

console.log('notifications self-check passed')
