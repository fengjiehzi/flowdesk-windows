import React, { useEffect, useRef, useState } from 'react'
import type { FluidCloudSettings } from '../../shared/settings'

type FluxCanvasProps = {
  cloud: FluidCloudSettings
  baseColor?: string
  mistColor?: string
  active?: boolean
  animated?: boolean
  interactive?: boolean
  paused?: boolean
  className?: string
}

type FluxResources = {
  program: WebGLProgram
  buffer: WebGLBuffer
  position: number
  uniforms: Record<string, WebGLUniformLocation | null>
}

const vertexShaderSource = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

// Adapted from KTBOY/shuke-lab-flux under MIT. See THIRD_PARTY_NOTICES.md.
const fragmentShaderSource = `
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uHover;
uniform float uSeed;
uniform float uNoiseScale;
uniform float uWarp;
uniform float uDensity;
uniform vec3 uBaseColor;
uniform vec3 uMistColor;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.55;
  mat2 rotation = mat2(0.8, 0.6, -0.6, 0.8);
  for (int layer = 0; layer < 5; layer++) {
    value += amplitude * noise(p);
    p = rotation * p * 2.0 + 3.7;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float noiseScale = 1.6 * (uNoiseScale / 1.2);
  float warpScale = uWarp / 0.55;
  vec2 p = uv * vec2(aspect, 1.0) * noiseScale;

  vec2 q = vec2(
    fbm(p + uTime * vec2(0.6, 0.2)),
    fbm(p + uTime * vec2(-0.4, 0.5) + 5.2)
  );
  vec2 r = vec2(
    fbm(p + 2.2 * warpScale * q + vec2(1.7, 9.2) + uTime * vec2(0.3, -0.4)),
    fbm(p + 2.2 * warpScale * q + vec2(8.3, 2.8) + uTime * vec2(-0.2, 0.3))
  );
  float f = fbm(p + 2.4 * warpScale * r);

  vec3 col = mix(uColor1, uColor2, smoothstep(0.15, 0.62, f));
  col = mix(col, uColor3, smoothstep(0.60, 0.95, f));
  col += 0.15 * r.y * uColor2;
  col = mix(col, col * col * 1.35 + col * 0.12, uHover * 0.55);

  float colorZone = smoothstep(0.30, 0.80, uv.x + 0.15 * (q.y - 0.5));
  float whiteMist = smoothstep(0.50, 1.05, uv.y) * 0.55;
  float densityShift = (uDensity - 1.0) * 0.18;
  float density = smoothstep(0.32, 0.85, f + 0.22 * r.x + densityShift);
  float mask = clamp(density + colorZone * 0.15 * uDensity, 0.0, 1.0);
  vec3 outputColor = mix(uBaseColor, col, mask);
  outputColor = mix(outputColor, uMistColor, whiteMist * (1.0 - mask * 0.55));
  gl_FragColor = vec4(outputColor, 1.0);
}`

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL shader allocation failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  const message = gl.getShaderInfoLog(shader) || 'Unknown shader error'
  gl.deleteShader(shader)
  throw new Error(message)
}

function createResources(gl: WebGLRenderingContext): FluxResources {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL program allocation failed')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown WebGL link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('WebGL buffer allocation failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'aPosition')
  gl.useProgram(program)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const names = ['uResolution', 'uTime', 'uHover', 'uSeed', 'uNoiseScale', 'uWarp', 'uDensity', 'uBaseColor', 'uMistColor', 'uColor1', 'uColor2', 'uColor3']
  return {
    program,
    buffer,
    position,
    uniforms: Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]))
  }
}

function rgb(color: string): [number, number, number] {
  const value = color.slice(1)
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as [number, number, number]
}

function seedFor(value: string) {
  let hash = 0
  for (const character of value) hash = Math.imul(31, hash) + character.charCodeAt(0) | 0
  return Math.abs(hash % 997) / 997
}

export function FluxCanvas({
  cloud,
  baseColor = '#06080B',
  mistColor = '#F3F5F7',
  active = true,
  animated = true,
  interactive = true,
  paused = false,
  className = ''
}: FluxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cloudRef = useRef(cloud)
  const colorsRef = useRef({ baseColor, mistColor })
  const renderOnceRef = useRef<(() => void) | null>(null)
  const pausedRef = useRef(paused)
  const [fallback, setFallback] = useState(false)
  cloudRef.current = cloud
  colorsRef.current = { baseColor, mistColor }
  pausedRef.current = paused

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false })
    if (!gl) {
      setFallback(true)
      return
    }

    let resources: FluxResources | null = null
    let frame = 0
    let visible = !document.hidden
    let lost = false
    let flowTime = seedFor(cloudRef.current.shape) * 100
    let previousTime = performance.now()
    let hover = 0
    let hoverTarget = 0
    let stir = 0
    let previousPointer: [number, number] | null = null
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const initialize = () => {
      try {
        resources = createResources(gl)
        lost = false
        setFallback(false)
      } catch (error) {
        console.error('FLUX WebGL initialization failed', error)
        lost = true
        setFallback(true)
        throw error
      }
    }

    const resize = (cssWidth: number, cssHeight: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(cssWidth * dpr))
      const height = Math.max(1, Math.round(cssHeight * dpr))
      if (canvas.width === width && canvas.height === height) return
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
      draw()
    }

    const draw = () => {
      if (!resources || lost) return
      const current = cloudRef.current
      const colors = colorsRef.current
      gl.useProgram(resources.program)
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer)
      gl.enableVertexAttribArray(resources.position)
      gl.vertexAttribPointer(resources.position, 2, gl.FLOAT, false, 0, 0)
      gl.uniform2f(resources.uniforms.uResolution, canvas.width, canvas.height)
      gl.uniform1f(resources.uniforms.uTime, flowTime)
      gl.uniform1f(resources.uniforms.uHover, hover)
      gl.uniform1f(resources.uniforms.uSeed, seedFor(current.shape))
      gl.uniform1f(resources.uniforms.uNoiseScale, current.noiseScale)
      gl.uniform1f(resources.uniforms.uWarp, current.curvature)
      gl.uniform1f(resources.uniforms.uDensity, current.depth)
      gl.uniform3fv(resources.uniforms.uBaseColor, rgb(colors.baseColor))
      gl.uniform3fv(resources.uniforms.uMistColor, rgb(colors.mistColor))
      gl.uniform3fv(resources.uniforms.uColor1, rgb(current.color))
      gl.uniform3fv(resources.uniforms.uColor2, rgb(current.secondaryColor))
      gl.uniform3fv(resources.uniforms.uColor3, rgb(current.tertiaryColor))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const animate = (now: number) => {
      frame = 0
      if (pausedRef.current) return
      const delta = Math.min(.05, Math.max(0, (now - previousTime) / 1000))
      previousTime = now
      const current = cloudRef.current
      hover += (hoverTarget - hover) * Math.min(1, delta * 2.2 * current.response)
      const easedHover = hover * hover * (3 - 2 * hover)
      stir *= Math.exp(-delta * 1.6 * current.response)
      flowTime += delta * current.speed * (.22 + easedHover * .08 + stir * .55)
      draw()
      if (visible && active && animated && !pausedRef.current && !reducedMotion.matches) frame = requestAnimationFrame(animate)
    }

    const requestRender = () => {
      if (!resources || lost) return
      if (visible && active && animated && !pausedRef.current && !reducedMotion.matches) {
        if (!frame) {
          previousTime = performance.now()
          frame = requestAnimationFrame(animate)
        }
      } else {
        if (frame) cancelAnimationFrame(frame)
        frame = 0
        draw()
      }
    }
    renderOnceRef.current = requestRender

    const onPointerMove = (event: PointerEvent) => {
      if (!interactive || pausedRef.current) return
      const rect = canvas.getBoundingClientRect()
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      hoverTarget = inside ? 1 : 0
      if (inside) {
        const next: [number, number] = [event.clientX, event.clientY]
        if (previousPointer) stir = Math.min(1, stir + Math.hypot(next[0] - previousPointer[0], next[1] - previousPointer[1]) * .012)
        previousPointer = next
      } else previousPointer = null
      requestRender()
    }
    const onVisibility = () => {
      visible = !document.hidden
      if (!visible && frame) cancelAnimationFrame(frame)
      frame = 0
      requestRender()
    }
    const onMotionChange = () => {
      if (reducedMotion.matches && frame) cancelAnimationFrame(frame)
      frame = 0
      requestRender()
    }
    const onContextLost = (event: Event) => {
      event.preventDefault()
      lost = true
      resources = null
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
    const onContextRestored = () => {
      try {
        initialize()
        lost = false
        requestRender()
      } catch (error) {
        console.error('FLUX WebGL restore failed', error)
        lost = true
        setFallback(true)
      }
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) resize(entry.contentRect.width, entry.contentRect.height)
      requestRender()
    })
    const initialRect = canvas.getBoundingClientRect()
    resize(initialRect.width, initialRect.height)
    observer.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    reducedMotion.addEventListener('change', onMotionChange)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)

    try {
      initialize()
      requestRender()
    } catch (error) {
      console.error('FLUX WebGL initialization failed', error)
      setFallback(true)
    }

    return () => {
      renderOnceRef.current = null
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointerMove)
      reducedMotion.removeEventListener('change', onMotionChange)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      if (resources && !lost) {
        try {
          gl.deleteBuffer(resources.buffer)
          gl.deleteProgram(resources.program)
        } catch {
          // Ignore errors during cleanup if context is already lost
        }
      }
    }
  }, [active, animated, interactive])

  useEffect(() => renderOnceRef.current?.(), [cloud, baseColor, mistColor, paused])

  return (
    <canvas
      ref={canvasRef}
      className={`fluxCanvas ${fallback ? 'isFallback' : ''} ${className}`.trim()}
      style={{
        '--flux-base': baseColor,
        '--flux-mist': mistColor,
        '--flux-primary': cloud.color,
        '--flux-secondary': cloud.secondaryColor,
        '--flux-tertiary': cloud.tertiaryColor
      } as React.CSSProperties}
      aria-hidden
      data-renderer={fallback ? 'css' : 'webgl'}
    />
  )
}
