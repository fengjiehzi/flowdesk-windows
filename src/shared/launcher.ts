import { z } from 'zod'

export const maxLauncherEntries = 8
export const launcherNameSchema = z.string().trim().min(1).max(24)
export const launcherIconSchema = z.string().startsWith('data:image/png;base64,').max(400_000)
export const launcherEntryKindSchema = z.enum(['app', 'website', 'file', 'script', 'folder'])

export const launcherEntryViewSchema = z.object({
  id: z.string().uuid(),
  kind: launcherEntryKindSchema,
  name: launcherNameSchema,
  icon: launcherIconSchema.optional()
})

export const launcherStateSchema = z.object({
  setupCompleted: z.boolean(),
  entries: z.array(launcherEntryViewSchema).max(maxLauncherEntries),
  localEntries: z.array(launcherEntryViewSchema.extend({ path: z.string() })).default([]),
  recentEntries: z.array(launcherEntryViewSchema).max(50).default([])
})

export const launcherSearchSourceSchema = z.enum(['entry', 'local', 'recent', 'installed'])
export const launcherSearchRequestSchema = z.object({ source: launcherSearchSourceSchema, id: z.string().min(1).max(64) }).strict()
export type LauncherSearchRequest = z.infer<typeof launcherSearchRequestSchema>
export type LauncherSearchItem = Omit<LauncherEntryView, 'id'> & LauncherSearchRequest & { detail: string }
export type LauncherLaunchResult = { recentSaved: boolean }

export function looksLikeLocalPath(value: string) {
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(value.trim().replace(/^"(.*)"$/, '$1'))
}

export const installedAppCandidateSchema = z.object({
  id: z.string().min(12).max(64),
  name: launcherNameSchema,
  icon: launcherIconSchema.optional(),
  selectedEntryId: z.string().uuid().optional()
})

export const websiteShortcutInputSchema = z.object({
  name: launcherNameSchema,
  url: z.string().trim().min(1).max(2048)
})

export const renameShortcutInputSchema = z.object({
  id: z.string().uuid(),
  name: launcherNameSchema
})

export type LauncherEntryView = z.infer<typeof launcherEntryViewSchema>
export type LauncherState = z.infer<typeof launcherStateSchema>
export type InstalledAppCandidate = z.infer<typeof installedAppCandidateSchema>
export type WebsiteShortcutInput = z.infer<typeof websiteShortcutInputSchema>

export type DiscoveredApplication = {
  name: string
  launchType: 'path' | 'appId'
  target: string
  identity?: string
  iconSource?: string
  icon?: string
}

export type WindowsApplicationShortcut = {
  name: string
  shortcutPath: string
  targetPath: string
  arguments: string
  iconSource?: string
}

export function isLaunchableApplicationShortcut(shortcut: WindowsApplicationShortcut) {
  const executable = shortcut.targetPath.trim().toLocaleLowerCase()
  if (!executable.endsWith('.exe')) return false
  const executableName = executable.split(/[\\/]/).at(-1) ?? ''
  if (['cmd.exe', 'control.exe', 'cscript.exe', 'explorer.exe', 'mshta.exe', 'powershell.exe', 'pwsh.exe', 'rundll32.exe', 'wscript.exe'].includes(executableName)) return false
  if (/卸载|(?:^|[\s_-])(?:unins\d*|uninstall(?:er)?)(?:$|[\s_-])/i.test(shortcut.name)) return false
  return !/(?:https?|file):\/\/|(?:^|\s)["']?[^"']+\.(?:chm|html?|pdf)(?:["']?\s|$)/i.test(shortcut.arguments)
}

export function normalizeWebsiteUrl(value: string) {
  const input = value.trim()
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 http 或 https 网站')
  if (!url.hostname) throw new Error('网站地址无效')
  return url.toString()
}

export function isValidLauncherOrder(currentIds: string[], orderedIds: string[]) {
  if (currentIds.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length) return false
  const current = new Set(currentIds)
  return orderedIds.every((id) => current.has(id))
}

export function dedupeInstalledApplications(applications: DiscoveredApplication[]) {
  const identities = new Set<string>()
  const names = new Set<string>()
  const result: DiscoveredApplication[] = []

  for (const application of applications) {
    const name = application.name.trim().slice(0, 24)
    const target = application.target.trim()
    if (!name || !target) continue
    const identity = `${application.launchType}:${(application.identity || target).toLocaleLowerCase()}`
    const normalizedName = name.toLocaleLowerCase()
    if (identities.has(identity) || names.has(normalizedName)) continue
    identities.add(identity)
    names.add(normalizedName)
    result.push({ ...application, name, target })
  }

  return result.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }))
}
