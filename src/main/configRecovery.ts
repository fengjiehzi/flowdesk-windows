import { constants, copyFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'

export function loadRecoverableConfig<T>(
  store: { store: T; path: string },
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  recover: (value: unknown) => T
) {
  const original: unknown = store.store
  const parsed = schema.safeParse(original)
  if (parsed.success) return { data: parsed.data, backupPath: null }
  const data = schema.parse(recover(original))
  const backupPath = `${store.path}.recovery-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`
  // Back up the original bytes before replacing any invalid fields. Failure leaves the store untouched.
  copyFileSync(store.path, backupPath, constants.COPYFILE_EXCL)
  store.store = data
  return { data, backupPath }
}
