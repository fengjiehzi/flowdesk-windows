import { constants, copyFileSync, existsSync, renameSync } from 'node:fs'
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

export function createSafeStore<T>(
  filePath: string,
  factory: () => T,
  corruptBackupOut?: string[]
): T {
  try {
    return factory()
  } catch (error) {
    // 若配置文件存在损坏的 JSON 语法，先隔离备份再重新创建，避免应用启动崩溃。
    if (error instanceof SyntaxError && filePath && existsSync(filePath)) {
      const backup = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`
      renameSync(filePath, backup)
      corruptBackupOut?.push(backup)
      return factory()
    }
    throw error
  }
}
