import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { desktopBoxesActionSchema, desktopBoxesMessageSchema, type DesktopBoxesAction, type DesktopBoxesState } from '../shared/desktopBoxes'

type Options = {
  executablePath: string
  dataPath: string
  enabled: boolean
  onState: (state: DesktopBoxesState) => void
  onEnabledChange: (enabled: boolean) => void
  probe?: boolean
}

export class DesktopBoxesController {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private state: DesktopBoxesState = { running: false, active: false, busy: false }
  private sequence = 0
  private stopping = false
  private ready = false
  private pending = new Map<number, { resolve: (state: DesktopBoxesState) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

  constructor(private readonly options: Options) {}

  getState() { return { ...this.state } }

  private publish(state: DesktopBoxesState) {
    const changed = this.state.active !== state.active
    this.state = state
    if (changed && state.running && !this.stopping) {
      this.options.enabled = state.active
      this.options.onEnabledChange(state.active)
    }
    this.options.onState(this.getState())
  }

  private start() {
    if (this.starting) return this.starting
    if (this.child) return this.ready ? Promise.resolve() : Promise.reject(new Error('桌面整理正在退出，请稍后重试。'))
    if (!existsSync(this.options.executablePath)) return Promise.reject(new Error('桌面整理模块尚未生成，请先运行 npm run desktop:build。'))
    this.starting = new Promise<void>((resolve, reject) => {
      const args = [this.options.probe ? '--island-probe' : '--island', '--island-data', this.options.dataPath]
      if (this.options.enabled) args.push('--show')
      const child = spawn(this.options.executablePath, args, { windowsHide: true, stdio: 'pipe' })
      this.child = child
      let ready = false
      let finished = false
      const timer = setTimeout(() => {
        reject(new Error('桌面整理启动超时，请检查是否已有 SmartDeskBox 正在运行。'))
        child.stdin.end()
      }, 60_000)
      const lines = createInterface({ input: child.stdout })
      lines.on('line', line => {
        let input: unknown
        try { input = JSON.parse(line) } catch { return }
        const parsed = desktopBoxesMessageSchema.safeParse(input)
        if (!parsed.success) return
        const message = parsed.data
        this.publish(message.state)
        if (message.ready !== undefined) {
          clearTimeout(timer)
          ready = message.ready
          this.ready = ready
          if (ready) resolve()
          else reject(new Error(message.error || '桌面整理启动失败'))
        }
        if (message.id !== undefined) {
          const request = this.pending.get(message.id)
          if (!request) return
          clearTimeout(request.timer)
          this.pending.delete(message.id)
          if (message.ok) request.resolve(this.getState())
          else request.reject(new Error(message.error || '桌面整理操作失败'))
        }
      })
      // Drain stderr so a native diagnostic cannot block the module.
      child.stderr.resume()
      child.stdin.on('error', () => {})
      const finish = (error?: Error, clean = false) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        lines.close()
        this.child = null
        this.ready = false
        const failure = error || new Error('桌面整理模块已退出')
        if (!ready) reject(failure)
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(failure) }
        this.pending.clear()
        if (clean && ready && !this.stopping) {
          this.options.enabled = false
          this.options.onEnabledChange(false)
        }
        this.publish({ running: false, active: false, busy: false, ...(!this.stopping && !clean ? { error: failure.message } : {}) })
      }
      child.once('error', finish)
      // The exit acknowledgement can arrive on stdout after the process exit event.
      child.once('close', code => finish(undefined, code === 0))
    }).finally(() => { this.starting = null })
    return this.starting
  }

  async command(input: unknown): Promise<DesktopBoxesState> {
    const action = desktopBoxesActionSchema.parse(input)
    if (action === 'exit') throw new Error('退出命令仅由灵动岛主进程使用')
    if (this.stopping) throw new Error('桌面整理正在退出，请稍后重试。')
    if (!this.child && action === 'hide') {
      this.options.enabled = false
      this.options.onEnabledChange(false)
      return this.getState()
    }
    if (!this.child && action === 'state') return this.getState()
    await this.start()
    return this.send(action)
  }

  private send(action: DesktopBoxesAction) {
    const child = this.child
    if (!child || child.stdin.destroyed) return Promise.reject(new Error('桌面整理模块未运行'))
    const id = ++this.sequence
    return new Promise<DesktopBoxesState>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('桌面整理操作仍未完成，请完成文件操作后重试。'))
      }, action === 'refresh' ? 120_000 : 10_000)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, action })}\n`, 'utf8', error => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  async restore() {
    if (this.options.enabled) { await this.start(); return this.getState() }
    return this.getState()
  }

  async shutdown() {
    if (!this.child) return
    if (this.starting) await this.starting
    const child = this.child
    if (!child) return
    this.stopping = true
    try {
      await this.send('exit')
      await new Promise<void>((resolve, reject) => {
        if (this.child !== child) { resolve(); return }
        const timer = setTimeout(() => reject(new Error('桌面整理仍在退出，请等待文件操作完成后重试。')), 10_000)
        child.once('close', () => { clearTimeout(timer); resolve() })
      })
    } finally { this.stopping = false }
  }
}
