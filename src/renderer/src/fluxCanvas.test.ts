import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { defaultSettings } from '../../shared/settings'

test('pausing the actual canvas retains resources, redraws resize and resumes one animation loop', () => {
  const refs: any[] = [], states: any[] = [], effects: any[] = []
  let cursor = 0, now = 0, id = 0, programs = 0, deleted = 0, draws = 0
  let resize!: (entries: any[]) => void
  const frames = new Map<number, (now: number) => void>()
  const times: number[] = []
  const gl = new Proxy({
    createProgram: () => { programs++; return {} }, createBuffer: () => ({}), createShader: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: (_: unknown, name: string) => name,
    uniform1f: (name: string, value: number) => { if (name === 'uTime') times.push(value) },
    drawArrays: () => draws++, deleteProgram: () => deleted++
  } as Record<string, any>, { get: (target, key: string) => target[key] ?? (() => {}) })
  const canvas = Object.assign(new EventTarget(), {
    width: 300, height: 150, getContext: () => gl,
    getBoundingClientRect: () => ({ width: 400, height: 120 })
  })
  const motion = Object.assign(new EventTarget(), { matches: false })
  const window = Object.assign(new EventTarget(), { devicePixelRatio: 1, matchMedia: () => motion })
  const document = Object.assign(new EventTarget(), { hidden: false })
  const React = {
    useRef: (value: any) => { const slot = cursor++; return refs[slot] ??= { current: value } },
    useState: (value: any) => { const slot = cursor++; states[slot] ??= value; return [states[slot], (next: any) => { states[slot] = next }] },
    useEffect: (effect: () => any, deps: any[]) => {
      const slot = cursor++
      const old = effects[slot]
      if (!old || deps.some((value, index) => value !== old.deps[index])) effects[slot] = { deps, effect, cleanup: old?.cleanup, pending: true }
    },
    createElement: (_: any, props: any) => ({ props })
  }
  const module = { exports: {} as any }
  const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('./fluxCanvas.tsx', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module, exports: module.exports, require: (name: string) => name === 'react/jsx-runtime' ? { jsx: React.createElement } : React, window, document, console,
    performance: { now: () => now }, Float32Array,
    ResizeObserver: class { constructor(callback: any) { resize = callback } observe() {} disconnect() {} },
    requestAnimationFrame: (callback: (now: number) => void) => { frames.set(++id, callback); return id },
    cancelAnimationFrame: (key: number) => frames.delete(key)
  })
  const render = (paused: boolean) => {
    cursor = 0
    const result = module.exports.FluxCanvas({ cloud: defaultSettings.fluidCloud, paused })
    result.props.ref.current = canvas
    for (const effect of effects.filter(Boolean)) if (effect.pending) {
      effect.cleanup?.(); effect.cleanup = effect.effect(); effect.pending = false
    }
  }
  const tick = () => {
    now += 16
    const pending = [...frames]; frames.clear()
    for (const [, callback] of pending) callback(now)
  }
  render(false); tick()
  assert.equal(programs, 1)
  assert.equal(frames.size, 1)
  render(true)
  assert.equal(frames.size, 0, 'Paused canvas must stop its pending frame')
  const pausedTime = times.at(-1)
  const previousDraws = draws
  resize([{ contentRect: { width: 420, height: 120 } }])
  assert.ok(draws > previousDraws, 'Resize must repaint immediately while paused')
  assert.equal(times.at(-1), pausedTime)
  now += 3000
  render(false); tick()
  assert.equal(frames.size, 1)
  assert.equal(programs, 1)
  assert.equal(deleted, 0)
  assert.ok(times.at(-1)! > pausedTime! && times.at(-1)! - pausedTime! < .1)
  for (const effect of effects.filter(Boolean)) effect.cleanup?.()
  assert.equal(frames.size, 0)
  assert.equal(deleted, 1)
})
