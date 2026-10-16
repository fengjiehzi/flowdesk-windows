import { z } from 'zod'

export const desktopBoxesActionSchema = z.enum(['show', 'hide', 'manage', 'settings', 'refresh', 'state', 'exit'])
export type DesktopBoxesAction = z.infer<typeof desktopBoxesActionSchema>

export const desktopBoxesStateSchema = z.object({
  running: z.boolean(),
  active: z.boolean(),
  busy: z.boolean(),
  error: z.string().optional()
})
export type DesktopBoxesState = z.infer<typeof desktopBoxesStateSchema>

export const desktopBoxesMessageSchema = z.object({
  id: z.number().int().optional(),
  ready: z.boolean().optional(),
  ok: z.boolean().optional(),
  error: z.string().optional(),
  state: desktopBoxesStateSchema
})
