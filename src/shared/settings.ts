import { z } from 'zod'
import { defaultTriggerStyle, triggerStyles } from './triggerGesture'

export const themes = ['graphite', 'aurora', 'ember', 'cobalt', 'plum', 'citrus', 'slate', 'rose'] as const

export const fluidCloudSchema = z.object({
  shape: z.enum(triggerStyles).default(defaultTriggerStyle),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#59d6ff'),
  strands: z.number().int().min(1).max(8).default(5),
  particles: z.number().int().min(0).max(16).default(8),
  speed: z.number().min(0.25).max(2).default(1),
  response: z.number().min(0.2).max(1.5).default(1),
  widthScale: z.number().min(0.7).max(1.3).default(1),
  heightScale: z.number().min(0.6).max(1.6).default(1),
  depth: z.number().min(0.5).max(1.5).default(1),
  curvature: z.number().min(0).max(1).default(0.55),
  symmetry: z.number().min(0).max(1).default(1)
})

export const fluidCloudCreationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(24),
  cloud: fluidCloudSchema
})

export const settingsSchema = z.object({
  triggerHeight: z.number().int().min(2).max(20).default(8),
  triggerWidth: z.number().int().min(120).max(800).default(320),
  triggerPosition: z.number().min(0).max(1).default(0.5),
  hideDelayMs: z.number().int().min(300).max(3000).default(800),
  position: z.enum(['left', 'center', 'right']).default('center'),
  opacity: z.number().min(0.7).max(1).default(0.95),
  theme: z.enum(themes).default('graphite'),
  launchAtLogin: z.boolean().default(false),
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
  .extend({ fluidCloud: fluidCloudSchema.partial().optional() })
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
