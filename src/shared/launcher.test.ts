import assert from 'node:assert/strict'
import {
  dedupeInstalledApplications,
  isLaunchableApplicationShortcut,
  isValidLauncherOrder,
  launcherStateSchema,
  maxLauncherEntries,
  looksLikeLocalPath,
  normalizeWebsiteUrl
} from './launcher'

assert.equal(normalizeWebsiteUrl('example.com'), 'https://example.com/')
assert.equal(normalizeWebsiteUrl('http://example.com/docs'), 'http://example.com/docs')
assert.throws(() => normalizeWebsiteUrl('file:///C:/Windows'))
assert.equal(looksLikeLocalPath('D:\\工具\\便携软件.exe'), true)
assert.equal(looksLikeLocalPath('"D:\\工具\\脚本.cmd"'), true)
assert.equal(looksLikeLocalPath('\\\\server\\share\\folder'), true)
assert.equal(looksLikeLocalPath('https://example.com'), false)
assert.equal(looksLikeLocalPath('relative-file.txt'), false)

const shortcut = {
  name: 'Visual Studio Code',
  shortcutPath: 'C:\\Start Menu\\Visual Studio Code.lnk',
  targetPath: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
  arguments: '',
  iconSource: 'C:\\Program Files\\Microsoft VS Code\\Code.exe'
}
assert.equal(isLaunchableApplicationShortcut(shortcut), true)
assert.equal(isLaunchableApplicationShortcut({ ...shortcut, name: '卸载 Visual Studio Code' }), false)
assert.equal(isLaunchableApplicationShortcut({ ...shortcut, targetPath: 'C:\\Windows\\explorer.exe' }), false)
assert.equal(isLaunchableApplicationShortcut({ ...shortcut, arguments: 'https://example.com/docs' }), false)
assert.equal(isLaunchableApplicationShortcut({ ...shortcut, targetPath: 'C:\\Docs\\manual.chm' }), false)

const ids = [
  'a85b5fd7-a40b-41ce-9f54-199384aca159',
  '3417bb64-2d61-46cc-86cb-1181ae0d0bde'
]
assert.equal(isValidLauncherOrder(ids, [...ids].reverse()), true)
assert.equal(isValidLauncherOrder(ids, [ids[0], ids[0]]), false)
assert.equal(isValidLauncherOrder(ids, [ids[0]]), false)

const deduped = dedupeInstalledApplications([
  { name: '记事本', launchType: 'path', target: 'C:\\Notepad.lnk', identity: 'C:\\Windows\\notepad.exe' },
  { name: '记事本', launchType: 'appId', target: 'Microsoft.Notepad' },
  { name: '画图', launchType: 'appId', target: 'Microsoft.Paint' }
])
assert.deepEqual(deduped.map(({ name }) => name), ['画图', '记事本'])

const entry = {
  id: ids[0],
  kind: 'app' as const,
  name: '记事本'
}
assert.equal(launcherStateSchema.safeParse({
  setupCompleted: false,
  entries: Array.from({ length: maxLauncherEntries }, (_, index) => ({ ...entry, id: crypto.randomUUID(), name: `应用${index}` }))
}).success, true)
assert.equal(launcherStateSchema.safeParse({
  setupCompleted: false,
  entries: Array.from({ length: maxLauncherEntries + 1 }, (_, index) => ({ ...entry, id: crypto.randomUUID(), name: `应用${index}` }))
}).success, false)

console.log('launcher self-check passed')
