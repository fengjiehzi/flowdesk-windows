import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function isTrustedRendererUrl(value: string, rendererPath: string, developmentUrl?: string) {
  try {
    const url = new URL(value)
    if (developmentUrl) {
      const expected = new URL(developmentUrl)
      return url.origin === expected.origin && url.pathname === expected.pathname && !url.username && !url.password
    }
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)).toLowerCase() === path.resolve(rendererPath).toLowerCase()
  } catch { return false }
}
