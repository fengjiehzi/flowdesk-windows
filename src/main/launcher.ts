import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, dialog, nativeImage, net, shell, type BrowserWindow } from 'electron'
import Store from 'electron-store'
import { z } from 'zod'
import {
  dedupeInstalledApplications,
  installedAppCandidateSchema,
  isLaunchableApplicationShortcut,
  isValidLauncherOrder,
  launcherEntryViewSchema,
  launcherStateSchema,
  maxLauncherEntries,
  normalizeWebsiteUrl,
  renameShortcutInputSchema,
  websiteShortcutInputSchema,
  type InstalledAppCandidate,
  type LauncherState,
  type WindowsApplicationShortcut,
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
  if (entry.launchType === 'path' && !['.exe', '.lnk'].includes(path.extname(entry.target).toLowerCase())) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '仅支持 .exe 和 .lnk 应用' })
  }
})
const launcherStoreSchema = z.object({
  setupCompleted: z.boolean().default(false),
  entries: z.array(storedLauncherEntrySchema).max(maxLauncherEntries).default([])
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
const powershellDiscoveryScript = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(
  [Environment]::GetFolderPath('Programs'),
  [Environment]::GetFolderPath('CommonPrograms'),
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
$shell = New-Object -ComObject WScript.Shell
$items = @()
foreach ($root in $roots) {
  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.lnk') {
    $shortcut = $shell.CreateShortcut($file.FullName)
    $targetPath = [Environment]::ExpandEnvironmentVariables($shortcut.TargetPath)
    $iconSource = [Environment]::ExpandEnvironmentVariables(($shortcut.IconLocation -replace ',-?\\d+$', '').Trim('"'))
    $items += [pscustomobject]@{
      name = $file.BaseName
      shortcutPath = $file.FullName
      targetPath = $targetPath
      arguments = [string]$shortcut.Arguments
      iconSource = $iconSource
    }
  }
}
@($items) | ConvertTo-Json -Compress -Depth 3
`
const powershellShortcutScript = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$shortcutPath = $args[0]
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
[pscustomobject]@{
  name = [IO.Path]::GetFileNameWithoutExtension($shortcutPath)
  shortcutPath = $shortcutPath
  targetPath = [Environment]::ExpandEnvironmentVariables($shortcut.TargetPath)
  arguments = [string]$shortcut.Arguments
  iconSource = [Environment]::ExpandEnvironmentVariables(($shortcut.IconLocation -replace ',-?\\d+$', '').Trim('"'))
} | ConvertTo-Json -Compress
`

function publicState(data: LauncherStoreData): LauncherState {
  return launcherStateSchema.parse({
    setupCompleted: data.setupCompleted,
    entries: data.entries.map(({ id, kind, name, icon }) => ({ id, kind, name, icon }))
  })
}

function targetKey(entry: Pick<StoredLauncherEntry, 'launchType' | 'target'>) {
  return `${entry.launchType}:${entry.target.toLocaleLowerCase()}`
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
    if (declaredSize > 256_000) return undefined
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > 256_000) return undefined
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
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershellShortcutScript, shortcutPath], {
    windowsHide: true,
    timeout: 3000,
    maxBuffer: 256 * 1024,
    encoding: 'utf8'
  })
  return windowsShortcutSchema.parse(JSON.parse(stdout))
}

export class LauncherController {
  private data: LauncherStoreData
  private candidates = new Map<string, DiscoveredTarget>()

  constructor(
    private readonly store: Store<LauncherStoreData>,
    private readonly onChange: (state: LauncherState) => void
  ) {
    const parsed = launcherStoreSchema.safeParse({ ...defaultLauncherStore, ...store.store })
    this.data = parsed.success ? parsed.data : defaultLauncherStore
    if (!parsed.success) this.store.store = defaultLauncherStore
  }

  getState() {
    return publicState(this.data)
  }

  private save(next: LauncherStoreData) {
    this.data = launcherStoreSchema.parse(next)
    this.store.store = this.data
    const state = this.getState()
    this.onChange(state)
    return state
  }

  private ensureCapacity(additions = 1) {
    if (this.data.entries.length + additions > maxLauncherEntries) throw new Error(`最多添加 ${maxLauncherEntries} 个快捷入口`)
  }

  async discoverInstalledApps(refresh = false) {
    if (!this.candidates.size || refresh) {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershellDiscoveryScript], {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 5 * 1024 * 1024,
        encoding: 'utf8'
      })
      const raw = stdout.trim() ? JSON.parse(stdout) as unknown : []
      const shortcuts = z.array(windowsShortcutSchema).parse(Array.isArray(raw) ? raw : [raw])
      const applications = dedupeInstalledApplications(shortcuts
        .filter((shortcut) => isLaunchableApplicationShortcut(shortcut) && existsSync(shortcut.shortcutPath) && existsSync(shortcut.targetPath))
        .map((shortcut: WindowsApplicationShortcut) => ({
          name: shortcut.name,
          launchType: 'path' as const,
          target: shortcut.shortcutPath,
          identity: `${shortcut.targetPath}|${shortcut.arguments}`,
          iconSource: existsSync(shortcut.iconSource || '') ? shortcut.iconSource : shortcut.targetPath
        })))
      const candidates = new Map<string, DiscoveredTarget>()

      for (let offset = 0; offset < applications.length; offset += 16) {
        const batch = applications.slice(offset, offset + 16)
        const withIcons = await Promise.all(batch.map(async (application) => {
          const id = createHash('sha256').update(`${application.launchType}:${application.target}`).digest('hex').slice(0, 24)
          const icon = await fileIcon(application.iconSource, application.target)
          return installedAppCandidateSchema.parse({ id, name: application.name, icon })
        }))
        batch.forEach((application, index) => {
          const candidate = withIcons[index]
          candidates.set(candidate.id, { ...candidate, launchType: application.launchType, target: application.target })
        })
      }
      this.candidates = candidates
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
        ...additions.map(({ name, icon, launchType, target }) => ({
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
    return this.save({
      ...this.data,
      entries: [...this.data.entries, {
        id: randomUUID(),
        kind: 'app',
        name,
        icon: shortcut
          ? await fileIcon(existsSync(shortcut.iconSource || '') ? shortcut.iconSource : shortcut.targetPath, shortcut.targetPath, target)
          : await fileIcon(target),
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
    return this.save({
      ...this.data,
      entries: [...this.data.entries, {
        id: randomUUID(),
        kind: 'website',
        name: parsed.name,
        icon: await websiteIcon(target),
        launchType: 'url',
        target
      }]
    })
  }

  renameEntry(input: unknown) {
    const { id, name } = renameShortcutInputSchema.parse(input)
    if (!this.data.entries.some((entry) => entry.id === id)) throw new Error('快捷入口不存在')
    return this.save({
      ...this.data,
      entries: this.data.entries.map((entry) => entry.id === id ? { ...entry, name } : entry)
    })
  }

  removeEntry(entryId: unknown) {
    const id = z.string().uuid().parse(entryId)
    if (!this.data.entries.some((entry) => entry.id === id)) throw new Error('快捷入口不存在')
    return this.save({ ...this.data, entries: this.data.entries.filter((entry) => entry.id !== id) })
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

  async launchEntry(entryId: unknown) {
    const id = z.string().uuid().parse(entryId)
    const entry = this.data.entries.find((candidate) => candidate.id === id)
    if (!entry) throw new Error('快捷入口不存在')

    if (entry.launchType === 'path') {
      const error = await shell.openPath(entry.target)
      if (error) throw new Error(error)
    } else if (entry.launchType === 'appId') {
      await execFileAsync('explorer.exe', [`shell:AppsFolder\\${entry.target}`], { windowsHide: true, timeout: 3000 })
    } else {
      await shell.openExternal(entry.target, { activate: true })
    }
  }
}

export function createLauncherStore() {
  return new Store<LauncherStoreData>({ name: 'launcher', defaults: defaultLauncherStore })
}
