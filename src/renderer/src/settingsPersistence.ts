import { applySettingsPatch, type IslandSettings, type IslandSettingsPatch } from '../../shared/settings'
import type { SettingsUpdateResult } from '../../shared/types'

export type SaveStatus = 'saved' | 'saving' | 'error'
type Patch = IslandSettingsPatch

function merge(left: Patch, right: Patch): Patch {
  const result = { ...left, ...right }
  if (left.fluidCloud && right.fluidCloud) result.fluidCloud = { ...left.fluidCloud, ...right.fluidCloud }
  return result
}

export class SettingsPersistence {
  private pending: Patch = {}
  private inFlight: Patch = {}
  private running: Promise<boolean> | null = null
  private revision = -1
  status: SaveStatus = 'saved'

  constructor(
    private base: IslandSettings,
    private readonly send: (patch: Patch) => Promise<SettingsUpdateResult>,
    private readonly onChange: (settings: IslandSettings, status: SaveStatus) => void
  ) {}

  value() {
    return applySettingsPatch(this.base, merge(this.inFlight, this.pending))
  }

  receive(settings: IslandSettings, revision: number) {
    if (revision >= this.revision) {
      this.base = settings
      this.revision = revision
    }
    return this.value()
  }

  enqueue(patch: Patch) {
    this.pending = merge(this.pending, patch)
    this.status = 'saving'
    this.onChange(this.value(), this.status)
    return this.flush()
  }

  flush(): Promise<boolean> {
    if (this.running) return this.running
    if (!Object.keys(this.pending).length) return Promise.resolve(true)
    this.status = 'saving'
    this.onChange(this.value(), this.status)
    // Start on a microtask so synchronous edits share one patch and close can await the same promise.
    this.running = Promise.resolve().then(async () => {
      while (Object.keys(this.pending).length) {
        this.inFlight = this.pending
        this.pending = {}
        try {
          const saved = await this.send(this.inFlight)
          if (saved.settingsRevision >= this.revision) {
            this.base = saved.settings
            this.revision = saved.settingsRevision
          }
          this.inFlight = {}
          this.onChange(this.value(), 'saving')
        } catch {
          this.pending = merge(this.inFlight, this.pending)
          this.inFlight = {}
          this.status = 'error'
          this.onChange(this.value(), this.status)
          return false
        }
      }
      this.status = 'saved'
      this.onChange(this.value(), this.status)
      return true
    }).finally(() => { this.running = null })
    return this.running
  }
}
