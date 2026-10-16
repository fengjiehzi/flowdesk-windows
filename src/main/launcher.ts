import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, dialog, nativeImage, net, shell, type BrowserWindow } from 'electron'
import Store from 'electron-store'
import { z } from 'zod'
import { loadRecoverableConfig } from './configRecovery'
import { parseDiscoveredApplications, powershellDiscoveryScript } from './applicationDiscovery'
import {
  installedAppCandidateSchema,
  isLaunchableApplicationShortcut,
  isValidLauncherOrder,
  launcherEntryViewSchema,
  launcherStateSchema,
  launcherSearchRequestSchema,
  maxLauncherEntries,
  normalizeWebsiteUrl,
  renameShortcutInputSchema,
  websiteShortcutInputSchema,
  type InstalledAppCandidate,
  type LauncherState,
  type LauncherSearchItem,
  type WebsiteShortcutInput
} from '../shared/launcher'

const execFileAsync = promisify(execFile)
const launchTypeSchema = z.enum(['path', 'appId', 'url'])
const storedLauncherEntrySchema = launcherEntryViewSchema.extend({
  launchType: launchTypeSchema,
  target: z.string().trim().min(1).max(2048)
}).superRefine((entry, context) => {
  if (entry.kind === 'website' && entry.launchType !== 'url') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '网站入口类型无效' })
  }
  if (entry.kind === 'app' && entry.launchType === 'url') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '应用入口类型无效' })
  }
  if (entry.kind === 'app' && entry.launchType === 'path' && !['.exe', '.lnk'].includes(path.extname(entry.target).toLowerCase())) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '仅支持 .exe 和 .lnk 应用' })
  }
  if (['file', 'script', 'folder'].includes(entry.kind) && entry.launchType !== 'path') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '本地启动项必须使用文件路径' })
  }
})
const launcherStoreSchema = z.object({
  setupCompleted: z.boolean().default(false),
  entries: z.array(storedLauncherEntrySchema).max(maxLauncherEntries).default([]),
  localEntries: z.array(storedLauncherEntrySchema).default([]),
  recentEntries: z.array(storedLauncherEntrySchema).max(50).default([])
})
const windowsShortcutSchema = z.object({
  name: z.string(),
  shortcutPath: z.string(),
  targetPath: z.string(),
  arguments: z.string(),
  iconSource: z.string().optional()
})

type LauncherStoreData = z.infer<typeof launcherStoreSchema>
type StoredLauncherEntry = LauncherStoreData['entries'][number]
type DiscoveredTarget = InstalledAppCandidate & Pick<StoredLauncherEntry, 'launchType' | 'target'>

const defaultLauncherStore = launcherStoreSchema.parse({})
function publicState(data: LauncherStoreData): LauncherState {
  return launcherStateSchema.parse({
    setupCompleted: data.setupCompleted,
    entries: data.entries.map(({ id, kind, name, icon }) => ({ id, kind, name, icon })),
    localEntries: data.localEntries.map(({ id, kind, name, icon, target }) => ({ id, kind, name, icon, path: target })),
    recentEntries: data.recentEntries.map(({ id, kind, name, icon }) => ({ id, kind, name, icon }))
  })
}

function targetKey(entry: Pick<StoredLauncherEntry, 'launchType' | 'target'>) {
  return `${entry.launchType}:${entry.launchType === 'url' ? entry.target : entry.target.toLocaleLowerCase()}`
}

async function fileIcon(...sources: Array<string | undefined>) {
  for (const source of sources) {
    if (!source || !existsSync(source)) continue
    try {
      const extension = path.extname(source).toLowerCase()
      const image = extension === '.ico' || extension === '.png'
        ? nativeImage.createFromPath(source)
        : await app.getFileIcon(source, { size: 'large' })
      if (!image.isEmpty()) return image.resize({ width: 32, height: 32, quality: 'good' }).toDataURL()
    } catch {
      // Try the resolved executable when a shortcut-specific icon cannot be read.
    }
  }
  return undefined
}

async function websiteIcon(target: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await net.fetch(new URL('/favicon.ico', target).toString(), { signal: controller.signal })
    if (!response.ok) return undefined
    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > 256_000) {
      await response.body?.cancel()
      return undefined
    }
    const reader = response.body?.getReader()
    if (!reader) return undefined
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 256_000) {
          await reader.cancel()
          return undefined
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    if (!size) return undefined
    const bytes = Buffer.concat(chunks, size)
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return undefined
    return `data:image/png;base64,${image.resize({ width: 32, height: 32, quality: 'good' }).toPNG().toString('base64')}`
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveWindowsShortcut(shortcutPath: string) {
  const shortcut = shell.readShortcutLink(shortcutPath)
  return windowsShortcutSchema.parse({
    name: path.basename(shortcutPath, path.extname(shortcutPath)),
    shortcutPath,
    targetPath: shortcut.target,
    arguments: shortcut.args ?? '',
    iconSource: shortcut.icon
  })
}

export class LauncherController {
  private data: LauncherStoreData
  private candidates = new Map<string, DiscoveredTarget>()
  private removedEntry: { entry: StoredLauncherEntry; index: number } | null = null
  readonly recoveryBackupPath: string | null

  constructor(
    private readonly store: Store<LauncherStoreData>,
    private readonly onChange: (state: LauncherState) => void
  ) {
    const loaded = loadRecoverableConfig(store, launcherStoreSchema, (value) => {
      const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      const seen = new Set<string>()
      const entries = (Array.isArray(input.entries) ? input.entries : []).flatMap((entry) => {
        const parsed = storedLauncherEntrySchema.safeParse(entry)
        if (!parsed.success || seen.has(parsed.data.id)) return []
        seen.add(parsed.data.id)
        return [parsed.data]
      }).slice(0, maxLauncherEntries)
      const recoverList = (value: unknown) => (Array.isArray(value) ? value : []).flatMap(item => {
        const parsed = storedLauncherEntrySchema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
      return { setupCompleted: input.setupCompleted === true, entries, localEntries: recoverList(input.localEntries), recentEntries: recoverList(input.recentEntries).slice(0, 50) }
    })
    // Older versions could save different IDs for the same local and pinned target.
    const knownEntries = new Map([...loaded.data.localEntries, ...loaded.data.entries].map(entry => [targetKey(entry), entry]))
    this.data = {
      ...loaded.data,
      localEntries: loaded.data.localEntries.map(entry => knownEntries.get(targetKey(entry))!),
      recentEntries: loaded.data.recentEntries.map(entry => knownEntries.get(targetKey(entry)) ?? entry)
    }
    this.recoveryBackupPath = loaded.backupPath
  }

  getState() {
    return publicState(this.data)
  }

  private save(next: LauncherStoreData) {
    const parsed = launcherStoreSchema.parse(next)
    this.store.store = parsed
    this.data = parsed
    const state = this.getState()
    this.onChange(state)
    return state
  }

  private ensureCapacity(additions = 1) {
    if (this.data.entries.length + additions > maxLauncherEntries) throw new Error(`最多添加 ${maxLauncherEntries} 个快捷入口`)
  }

  async discoverInstalledApps(refresh = false) {
    if (!this.candidates.size || refresh) {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', powershellDiscoveryScript], {
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8'
      })
      const raw = stdout.trim() ? JSON.parse(stdout) as unknown : []
      const applications = parseDiscoveredApplications(raw)
      const candidates = new Map<string, DiscoveredTarget>()

      for (let offset = 0; offset < applications.length; offset += 16) {
        const batch = applications.slice(offset, offset + 16)
        const withIcons = await Promise.all(batch.map(async (application) => {
          const id = createHash('sha256').update(`${application.launchType}:${application.target}`).digest('hex').slice(0, 24)
          const icon = application.icon ?? await fileIcon(application.iconSource, application.target)
          return installedAppCandidateSchema.parse({ id, name: application.name, icon })
        }))
        batch.forEach((application, index) => {
          const candidate = withIcons[index]
          candidates.set(candidate.id, { ...candidate, launchType: application.launchType, target: application.target })
        })
      }
      this.candidates = candidates
      const icons = new Map([...candidates.values()].map((candidate) => [targetKey(candidate), candidate.icon]))
      const entries = this.data.entries.map((entry) => {
        const icon = icons.get(targetKey(entry))
        return entry.kind === 'app' && icon && icon !== entry.icon ? { ...entry, icon } : entry
      })
      if (entries.some((entry, index) => entry !== this.data.entries[index])) this.save({ ...this.data, entries })
    }

    const selected = new Map(
      this.data.entries
        .filter((entry) => entry.kind === 'app')
        .map((entry) => [targetKey(entry), entry.id])
    )
    return [...this.candidates.values()].map(({ launchType, target, ...candidate }) => ({
      ...candidate,
      selectedEntryId: selected.get(targetKey({ launchType, target }))
    }))
  }

  addInstalledApps(candidateIds: unknown) {
    const ids = [...new Set(z.array(z.string().min(12).max(64)).max(maxLauncherEntries).parse(candidateIds))]
    const existing = new Set(this.data.entries.map(targetKey))
    const additions = ids.map((id) => {
      const candidate = this.candidates.get(id)
      if (!candidate) throw new Error('应用候选项已失效，请刷新后重试')
      return candidate
    }).filter((candidate) => !existing.has(targetKey(candidate)))
    this.ensureCapacity(additions.length)
    if (!additions.length) return this.getState()

    return this.save({
      ...this.data,
      entries: [
        ...this.data.entries,
        ...additions.map(({ name, icon, launchType, target }) => this.data.localEntries.find(entry =>
          targetKey(entry) === targetKey({ launchType, target })) ?? ({
          id: randomUUID(),
          kind: 'app' as const,
          name,
          icon,
          launchType,
          target
        }))
      ]
    })
  }

  async pickLocalApplication(parent?: BrowserWindow) {
    const options: Electron.OpenDialogOptions = {
      title: '选择本地应用',
      properties: ['openFile'],
      filters: [{ name: '应用或快捷方式', extensions: ['exe', 'lnk'] }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const target = path.resolve(result.filePaths[0])
    if (!['.exe', '.lnk'].includes(path.extname(target).toLowerCase())) throw new Error('仅支持 .exe 和 .lnk 应用')
    if (this.data.entries.some((entry) => targetKey(entry) === targetKey({ launchType: 'path', target }))) {
      throw new Error('该应用已经添加')
    }
    this.ensureCapacity()
    const name = path.basename(target, path.extname(target)).trim().slice(0, 24)
    const shortcut = path.extname(target).toLowerCase() === '.lnk' ? await resolveWindowsShortcut(target) : null
    if (shortcut && (!isLaunchableApplicationShortcut(shortcut) || !existsSync(shortcut.targetPath))) {
      throw new Error('该快捷方式不是可启动应用')
    }
    const icon = shortcut
      ? await fileIcon(existsSync(shortcut.iconSource || '') ? shortcut.iconSource : shortcut.targetPath, shortcut.targetPath, target)
      : await fileIcon(target)
    if (this.data.entries.some((entry) => targetKey(entry) === targetKey({ launchType: 'path', target }))) {
      throw new Error('该应用已经添加')
    }
    this.ensureCapacity()
    return this.save({
      ...this.data,
      entries: [...this.data.entries, this.data.localEntries.find(entry =>
        targetKey(entry) === targetKey({ launchType: 'path', target })) ?? {
        id: randomUUID(),
        kind: 'app',
        name,
        icon,
        launchType: 'path',
        target
      }]
    })
  }

  async addWebsite(input: WebsiteShortcutInput) {
    const parsed = websiteShortcutInputSchema.parse(input)
    const target = normalizeWebsiteUrl(parsed.url)
    if (this.data.entries.some((entry) => entry.launchType === 'url' && entry.target === target)) {
      throw new Error('该网站已经添加')
    }
    this.ensureCapacity()
    const icon = await websiteIcon(target)
    if (this.data.entries.some((entry) => entry.launchType === 'url' && entry.target === target)) {
      throw new Error('该网站已经添加')
    }
    this.ensureCapacity()
    return this.save({
      ...this.data,
      entries: [...this.data.entries, {
        id: randomUUID(),
        kind: 'website',
        name: parsed.name,
        icon,
        launchType: 'url',
        target
      }]
    })
  }

  renameEntry(input: unknown) {
    const { id, name } = renameShortcutInputSchema.parse(input)
    if (![...this.data.entries, ...this.data.localEntries].some((entry) => entry.id === id)) throw new Error('快捷入口不存在')
    return this.save({
      ...this.data,
      entries: this.data.entries.map((entry) => entry.id === id ? { ...entry, name } : entry),
      localEntries: this.data.localEntries.map((entry) => entry.id === id ? { ...entry, name } : entry),
      recentEntries: this.data.recentEntries.map((entry) => entry.id === id ? { ...entry, name } : entry)
    })
  }

  removeEntry(entryId: unknown) {
    const id = z.string().uuid().parse(entryId)
    const index = this.data.entries.findIndex((entry) => entry.id === id)
    if (index < 0) throw new Error('快捷入口不存在')
    const removed = { entry: this.data.entries[index], index }
    const state = this.save({ ...this.data, entries: this.data.entries.filter((entry) => entry.id !== id) })
    this.removedEntry = removed
    return state
  }

  restoreRemovedEntry() {
    if (!this.removedEntry) throw new Error('没有可撤销的删除')
    this.ensureCapacity()
    const { entry, index } = this.removedEntry
    if (this.data.entries.some((item) => item.id === entry.id || targetKey(item) === targetKey(entry))) throw new Error('该入口已存在')
    const entries = [...this.data.entries]
    entries.splice(Math.min(index, entries.length), 0, entry)
    const state = this.save({ ...this.data, entries })
    this.removedEntry = null
    return state
  }

  reorderEntries(entryIds: unknown) {
    const ids = z.array(z.string().uuid()).max(maxLauncherEntries).parse(entryIds)
    if (!isValidLauncherOrder(this.data.entries.map(({ id }) => id), ids)) throw new Error('快捷入口排序无效')
    const entries = new Map(this.data.entries.map((entry) => [entry.id, entry]))
    return this.save({ ...this.data, entries: ids.map((id) => entries.get(id)!) })
  }

  completeSetup() {
    if (this.data.setupCompleted) return this.getState()
    return this.save({ ...this.data, setupCompleted: true })
  }

  async addLocalPaths(input: unknown) {
    const paths = [...new Set(z.array(z.string().trim().min(1).max(32767)).min(1).parse(input).map(value => {
      const expanded = value.replace(/^"(.*)"$/, '$1').replace(/%([^%]+)%/g, (token, name: string) => process.env[name] ?? token)
      if (!path.isAbsolute(expanded)) throw new Error('请输入文件或文件夹的完整路径')
      return path.resolve(expanded)
    }))]
    const additions: StoredLauncherEntry[] = []
    for (const target of paths) {
      if (!existsSync(target)) throw new Error(`路径不存在：${target}`)
      const key = targetKey({ launchType: 'path', target })
      if ([...this.data.localEntries, ...additions].some(item => targetKey(item) === key)) continue
      const existing = this.data.entries.find(item => targetKey(item) === key)
      const directory = statSync(target).isDirectory()
      const extension = path.extname(target).toLowerCase()
      const kind = directory ? 'folder' : ['.exe', '.lnk'].includes(extension) ? 'app' : ['.bat', '.cmd', '.ps1', '.py', '.js', '.mjs', '.cjs', '.vbs', '.sh'].includes(extension) ? 'script' : 'file'
      additions.push(existing ?? { id: randomUUID(), kind, name: (directory ? path.basename(target) || target : path.parse(target).name).slice(0, 24), launchType: 'path', target, icon: await fileIcon(target) })
    }
    const existingKeys = new Set(this.data.localEntries.map(targetKey))
    const unique = additions.filter(item => !existingKeys.has(targetKey(item))).map(item =>
      this.data.entries.find(entry => targetKey(entry) === targetKey(item)) ?? item)
    if (!unique.length) return this.getState()
    return this.save({ ...this.data, localEntries: [...this.data.localEntries, ...unique] })
  }

  async pickLocalTargets(mode: unknown, parent?: BrowserWindow) {
    const folder = z.enum(['files', 'folder']).parse(mode) === 'folder'
    const options: Electron.OpenDialogOptions = { title: folder ? '添加本地文件夹' : '添加文件、绿色软件或脚本', properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'] }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths.length ? null : this.addLocalPaths(result.filePaths)
  }

  removeLocalEntry(entryId: unknown) {
    const id = z.string().uuid().parse(entryId)
    const entry = this.data.localEntries.find(item => item.id === id)
    if (!entry) throw new Error('本地启动项不存在')
    const keep = (item: StoredLauncherEntry) => targetKey(item) !== targetKey(entry)
    return this.save({ ...this.data, localEntries: this.data.localEntries.filter(keep), entries: this.data.entries.filter(keep), recentEntries: this.data.recentEntries.filter(keep) })
  }

  pinLocalEntry(entryId: unknown, value: unknown) {
    const id = z.string().uuid().parse(entryId)
    const pinned = z.boolean().parse(value)
    const entry = this.data.localEntries.find(item => item.id === id)
    if (!entry) throw new Error('本地启动项不存在')
    const existing = this.data.entries.find(item => targetKey(item) === targetKey(entry))
    if (pinned && !existing) {
      this.ensureCapacity()
      return this.save({ ...this.data, entries: [...this.data.entries, entry] })
    }
    if (!pinned && existing) return this.removeEntry(existing.id)
    return this.getState()
  }

  searchEntries(value: unknown): LauncherSearchItem[] {
    const query = z.string().max(32767).parse(value).trim().toLocaleLowerCase()
    const found = new Map<string, LauncherSearchItem>()
    for (const [source, entries] of [['local', this.data.localEntries], ['entry', this.data.entries], ['recent', this.data.recentEntries]] as const) {
      for (const entry of entries) {
        const key = targetKey(entry)
        if (!found.has(key) && `${entry.name} ${entry.target}`.toLocaleLowerCase().includes(query)) {
          found.set(key, { id: entry.id, source, name: entry.name, kind: entry.kind, icon: entry.icon, detail: entry.target })
        }
      }
    }
    for (const entry of this.candidates.values()) {
      const key = targetKey(entry)
      if (!found.has(key) && entry.name.toLocaleLowerCase().includes(query)) found.set(key, { id: entry.id, source: 'installed', name: entry.name, kind: 'app', icon: entry.icon, detail: '已扫描的应用' })
    }
    return [...found.values()]
  }

  async launchSearchItem(input: unknown) {
    const request = launcherSearchRequestSchema.parse(input)
    const collection = request.source === 'entry' ? this.data.entries : request.source === 'local' ? this.data.localEntries : request.source === 'recent' ? this.data.recentEntries : null
    let entry = collection?.find(item => item.id === request.id)
    if (request.source === 'installed') {
      const candidate = this.candidates.get(request.id)
      if (candidate) entry = [...this.data.entries, ...this.data.localEntries, ...this.data.recentEntries].find(item => targetKey(item) === targetKey(candidate))
        ?? { ...candidate, id: randomUUID(), kind: 'app' }
    }
    if (!entry) throw new Error('启动项不存在，请刷新后重试')
    return this.launchRecord(entry)
  }

  async launchEntry(entryId: unknown) {
    const id = z.string().uuid().parse(entryId)
    const entry = this.data.entries.find((candidate) => candidate.id === id)
    if (!entry) throw new Error('快捷入口不存在')
    return this.launchRecord(entry)
  }

  private async launchRecord(entry: StoredLauncherEntry) {
    if (entry.launchType === 'path') {
      if (!existsSync(entry.target)) throw new Error('文件或文件夹不存在，请在本地启动管理中更新路径')
      const error = await shell.openPath(entry.target)
      if (error) throw new Error(error)
    } else if (entry.launchType === 'appId') {
      await execFileAsync('explorer.exe', [`shell:AppsFolder\\${entry.target}`], { windowsHide: true, timeout: 3000 })
    } else {
      await shell.openExternal(entry.target, { activate: true })
    }
    try {
      this.save({ ...this.data, recentEntries: [entry, ...this.data.recentEntries.filter(item => targetKey(item) !== targetKey(entry))].slice(0, 50) })
      return { recentSaved: true }
    } catch { return { recentSaved: false } }
  }
}

export function createLauncherStore() {
  return new Store<LauncherStoreData>({ name: 'launcher', defaults: defaultLauncherStore })
}
