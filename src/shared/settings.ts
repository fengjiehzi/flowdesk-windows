import { z } from 'zod'
import { mutedNotificationAppSchema } from './notifications'
import { defaultTriggerStyle, deriveFluxPalette, triggerStyles } from './triggerGesture'

export const themes = ['graphite', 'aurora', 'ember', 'cobalt', 'plum', 'citrus', 'slate', 'rose'] as const

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const fluidCloudValueSchema = z.object({
  shape: z.enum(triggerStyles).default(defaultTriggerStyle),
  color: colorSchema.default('#59D6FF'),
  secondaryColor: colorSchema.default('#34D399'),
  tertiaryColor: colorSchema.default('#8B5CF6'),
  speed: z.number().min(0.25).max(2).default(1),
  response: z.number().min(0.2).max(1.5).default(1),
  noiseScale: z.number().min(0.5).max(3).default(1.2),
  depth: z.number().min(0.5).max(1.5).default(1),
  curvature: z.number().min(0).max(1).default(0.55)
})

function upgradeFluidCloud(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? {}
  const cloud = value as Record<string, unknown>
  const hasColor = typeof cloud.color === 'string' && colorSchema.safeParse(cloud.color).success
  const color = hasColor ? cloud.color as string : '#59D6FF'
  const [, derivedSecondary, derivedTertiary] = deriveFluxPalette(color)
  const secondaryColor = hasColor ? derivedSecondary : '#34D399'
  const tertiaryColor = hasColor ? derivedTertiary : '#8B5CF6'
  return {
    ...cloud,
    secondaryColor: cloud.secondaryColor ?? secondaryColor,
    tertiaryColor: cloud.tertiaryColor ?? tertiaryColor,
    noiseScale: cloud.noiseScale ?? 1.2
  }
}

export const fluidCloudSchema = z.preprocess(upgradeFluidCloud, fluidCloudValueSchema)

export const fluidCloudCreationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(24),
  cloud: fluidCloudSchema
})

export const settingsSchema = z.object({
  hideDelayMs: z.number().int().min(300).max(3000).default(800),
  position: z.enum(['left', 'center', 'right']).default('center'),
  opacity: z.number().min(0.7).max(1).default(0.95),
  theme: z.enum(themes).default('graphite'),
  launchAtLogin: z.boolean().default(false),
  clipboardArchiveEnabled: z.boolean().default(false),
  notificationsEnabled: z.boolean().default(false),
  desktopPopupNotificationsEnabled: z.boolean().default(false),
  showNotificationPreview: z.boolean().default(true),
  notificationOnboardingDismissed: z.boolean().default(false),
  mutedNotificationApps: z.array(mutedNotificationAppSchema).max(100).default([]),
  fluidCloud: fluidCloudSchema.default({}),
  fluidCloudCreations: z.array(fluidCloudCreationSchema).max(32).default([])
})

export type IslandSettings = z.infer<typeof settingsSchema>
export type FluidCloudSettings = IslandSettings['fluidCloud']
export type FluidCloudCreation = IslandSettings['fluidCloudCreations'][number]

export const defaultSettings = settingsSchema.parse({})
export const settingsPatchSchema = settingsSchema
  .omit({ fluidCloud: true })
  .partial()
  .extend({ fluidCloud: fluidCloudValueSchema.partial().optional() })
  .strict()

export function applySettingsPatch(current: IslandSettings, patch: unknown) {
  const parsedPatch = settingsPatchSchema.parse(patch)
  return settingsSchema.parse({
    ...current,
    ...parsedPatch,
    fluidCloud: parsedPatch.fluidCloud
      ? { ...current.fluidCloud, ...parsedPatch.fluidCloud }
      : current.fluidCloud
  })
}
