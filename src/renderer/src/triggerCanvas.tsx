import React, { useEffect, useRef } from 'react'
import type { FluidCloudSettings } from '../../shared/settings'
import { classicTriggerStyles, triggerPresets, type TriggerStyle } from '../../shared/triggerGesture'

type TriggerCanvasProps = {
  cloud: FluidCloudSettings
  active?: boolean
  animated?: boolean
  pointerResponsive?: boolean
  className?: string
}

type Frame = {
  context: CanvasRenderingContext2D
  width: number
  height: number
  time: number
  cloud: FluidCloudSettings
  focus: number
}

const rgba = (hex: string, alpha: number) => {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${Math.max(0, Math.min(1, alpha))})`
}

const seeded = (index: number, salt = 0) => {
  const value = Math.sin(index * 91.731 + salt * 17.113) * 43758.5453
  return value - Math.floor(value)
}

function glow(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, rgba(color, alpha))
  gradient.addColorStop(.38, rgba(color, alpha * .35))
  gradient.addColorStop(1, rgba(color, 0))
  context.fillStyle = gradient
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
}

function particles({ context, width, height, time, cloud, focus }: Frame, amount = cloud.particles, fall = false) {
  context.save()
  context.globalCompositeOperation = 'lighter'
  for (let index = 0; index < amount; index++) {
    const progress = (time * (.00004 + seeded(index, 2) * .000035) + seeded(index, 8)) % 1
    const spread = (seeded(index, 3) - .5) * width * .82
    const x = focus + spread * (fall ? 1 - progress * .22 : 1) + Math.sin(time * .001 + index) * 7
    const y = fall
      ? -4 + progress * (height + 12)
      : 4 + seeded(index, 5) * Math.max(12, height * .48) + Math.sin(time * .0012 + index) * 3
    const radius = 1 + seeded(index, 6) * 1.4
    context.fillStyle = rgba(cloud.color, (.22 + seeded(index, 7) * .48) * Math.sin(progress * Math.PI))
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function drawFluid(frame: Frame) {
  const { context, width, time, cloud, focus } = frame
  const style = cloud.shape
  const presetIndex = [
    'quantum-membrane', 'condensate-core', 'ion-waterfall', 'phase-fold', 'vortex-gate',
    'plasma-fluid', 'liquid-glass', 'fluent-material', 'material-morph'
  ].indexOf(style)
  const baseDepth = (18 + presetIndex % 3 * 7) * cloud.depth
  const curve = .28 + cloud.curvature * .58
  const layers = Math.max(1, cloud.strands)
  context.save()
  context.globalCompositeOperation = 'lighter'

  for (let layer = layers - 1; layer >= 0; layer--) {
    const phase = time * (.00034 + presetIndex * .000025) + layer * .72
    const drift = Math.sin(phase) * (4 + (1 - cloud.symmetry) * 15)
    const depth = baseDepth + layer * 2.6
    const left = width * (.05 + layer * .008)
    const right = width - left
    const gradient = context.createLinearGradient(left, 0, right, 0)
    gradient.addColorStop(0, rgba(cloud.color, 0))
    gradient.addColorStop(.25, rgba(cloud.color, .05 + layer * .008))
    gradient.addColorStop(.5, rgba(cloud.color, .28 - layer * .018))
    gradient.addColorStop(.75, rgba(cloud.color, .05 + layer * .008))
    gradient.addColorStop(1, rgba(cloud.color, 0))
    context.fillStyle = gradient
    context.beginPath()
    context.moveTo(left, 0)
    context.lineTo(right, 0)
    context.bezierCurveTo(right - width * curve, 3, focus + 45 + drift, depth * .66, focus + drift, depth)
    context.bezierCurveTo(focus - 45 + drift, depth * .66, left + width * curve, 3, left, 0)
    context.closePath()
    context.fill()
  }

  if (style === 'vortex-gate' || style === 'phase-fold') {
    for (let ring = 0; ring < Math.max(2, Math.round(layers / 2)); ring++) {
      const pulse = (time * .00018 + ring / layers) % 1
      context.strokeStyle = rgba(cloud.color, (1 - pulse) * .34)
      context.lineWidth = .7
      context.beginPath()
      context.ellipse(focus, 22 * cloud.depth, 18 + pulse * 72, 7 + pulse * 15, 0, 0, Math.PI * 2)
      context.stroke()
    }
  } else if (style === 'ion-waterfall') {
    for (let strand = 0; strand < layers; strand++) {
      const x = focus + (strand / Math.max(1, layers - 1) - .5) * width * .34
      const length = 18 + seeded(strand, 4) * 38
      const gradient = context.createLinearGradient(x, 2, x, length)
      gradient.addColorStop(0, rgba(cloud.color, .5))
      gradient.addColorStop(1, rgba(cloud.color, 0))
      context.strokeStyle = gradient
      context.beginPath()
      context.moveTo(x, 1)
      context.quadraticCurveTo(x + Math.sin(time * .001 + strand) * 8, length * .55, x, length)
      context.stroke()
    }
  } else if (style === 'plasma-fluid' || style === 'material-morph') {
    glow(context, focus, 22 * cloud.depth, 52 + layers * 3, cloud.color, .18)
  }

  context.restore()
  particles(frame, cloud.particles, style === 'ion-waterfall')
}

function drawInterface(frame: Frame) {
  const { context, width, time, cloud, focus } = frame
  const style = cloud.shape
  context.save()
  context.globalCompositeOperation = 'lighter'
  if (style === 'dot-matrix') {
    const columns = Math.max(8, cloud.particles)
    for (let index = 0; index < columns; index++) {
      const x = width * .08 + index * width * .84 / Math.max(1, columns - 1)
      const y = 10 + Math.sin(time * .0013 + index * .8) * 6 + Math.abs(x - focus) / width * 13
      context.fillStyle = rgba(cloud.color, .18 + .62 * (1 - Math.abs(x - focus) / width))
      context.fillRect(x - 1, y - 1, 2, 2)
    }
  } else {
    const barWidth = style === 'live-activity' ? width * .62 : width * .82
    const x = (width - barWidth) / 2
    const gradient = context.createLinearGradient(x, 0, x + barWidth, 0)
    gradient.addColorStop(0, rgba(cloud.color, .02))
    gradient.addColorStop(.5, rgba(cloud.color, .28))
    gradient.addColorStop(1, rgba(cloud.color, .02))
    context.fillStyle = gradient
    context.beginPath()
    context.roundRect(x, 4, barWidth, 28 * cloud.depth, style === 'live-activity' ? 15 : 7)
    context.fill()
    const progress = (time * .00012) % 1
    context.fillStyle = rgba(cloud.color, .72)
    context.beginPath()
    context.roundRect(x + 8, 28 * cloud.depth, (barWidth - 16) * progress, 1.5, 2)
    context.fill()
  }
  glow(context, focus, 18, 44, cloud.color, .12)
  context.restore()
  particles(frame, Math.min(cloud.particles, 8))
}

function polygon(context: CanvasRenderingContext2D, x: number, y: number, radius: number, sides: number, rotation = 0) {
  context.beginPath()
  for (let side = 0; side < sides; side++) {
    const angle = rotation + side * Math.PI * 2 / sides
    const px = x + Math.cos(angle) * radius
    const py = y + Math.sin(angle) * radius
    if (side === 0) context.moveTo(px, py)
    else context.lineTo(px, py)
  }
  context.closePath()
}

function drawGame(frame: Frame) {
  const { context, width, time, cloud, focus } = frame
  const style = cloud.shape
  context.save()
  context.globalCompositeOperation = 'lighter'
  const y = 22 * cloud.depth

  if (style === 'overclock-reactor') {
    const spin = time * .001
    for (let ring = 0; ring < 3; ring++) {
      context.strokeStyle = rgba(cloud.color, .52 - ring * .12)
      context.lineWidth = 1
      context.setLineDash([4 + ring * 2, 7])
      context.beginPath()
      context.ellipse(focus, y, 18 + ring * 10, 8 + ring * 4, spin * (ring % 2 ? -1 : 1), 0, Math.PI * 2)
      context.stroke()
    }
    context.setLineDash([])
    glow(context, focus, y, 48, cloud.color, .28)
  } else if (style === 'tactical-shield') {
    const radius = 46 + Math.sin(time * .001) * 3
    context.strokeStyle = rgba(cloud.color, .48)
    context.beginPath()
    context.arc(focus, y + 20, radius, Math.PI * 1.1, Math.PI * 1.9)
    context.stroke()
    context.strokeStyle = rgba(cloud.color, .16)
    for (let line = -2; line <= 2; line++) {
      context.beginPath()
      context.moveTo(focus - radius, y + 16 + line * 7)
      context.lineTo(focus + radius, y + 16 + line * 7)
      context.stroke()
    }
  } else if (style === 'void-rift') {
    context.strokeStyle = rgba(cloud.color, .72)
    context.lineWidth = 1.2
    context.beginPath()
    context.moveTo(width * .12, 2)
    for (let point = 0; point <= 12; point++) {
      const x = width * .12 + point * width * .76 / 12
      const distance = 1 - Math.abs(x - focus) / (width * .4)
      context.lineTo(x, 3 + Math.max(0, distance) * (12 + Math.sin(time * .001 + point) * 6) * cloud.depth)
    }
    context.stroke()
    glow(context, focus, y, 62, cloud.color, .18)
  } else if (style === 'warp-pulse') {
    const pulse = (time * .0005) % 1
    for (let side = -1; side <= 1; side += 2) {
      for (let line = 0; line < cloud.strands; line++) {
        const length = 28 + seeded(line, 7) * 120 * pulse
        const py = 5 + line * 5
        context.strokeStyle = rgba(cloud.color, (1 - pulse) * .6)
        context.beginPath()
        context.moveTo(focus + side * (22 + length), py)
        context.lineTo(focus + side * 18, y)
        context.stroke()
      }
    }
    glow(context, focus, y, 46, cloud.color, .24)
  } else if (style === 'cyber-dragon') {
    for (let scale = 0; scale < 15; scale++) {
      const x = width * .08 + scale * width * .84 / 14
      const py = 5 + Math.sin(time * .0011 + scale * .58) * 7 + Math.abs(x - focus) / width * 22
      context.fillStyle = rgba(cloud.color, .18 + .5 * (1 - Math.abs(x - focus) / width))
      polygon(context, x, py, 3.5, 4, Math.PI / 4)
      context.fill()
    }
  } else {
    for (let tile = 0; tile < Math.max(8, cloud.particles); tile++) {
      const progress = (time * .00018 + seeded(tile, 2)) % 1
      const x = focus + (seeded(tile, 3) - .5) * width * .78 * (1 - progress)
      const py = 2 + progress * 36
      context.strokeStyle = rgba(cloud.color, (1 - progress) * .7)
      polygon(context, x, py, 3 + seeded(tile, 5) * 4, 6, time * .0004)
      context.stroke()
    }
  }
  context.restore()
  if (style !== 'nano-armor') particles(frame, Math.min(cloud.particles, 10))
}

function drawAnime(frame: Frame) {
  const { context, width, time, cloud, focus } = frame
  const style = cloud.shape
  context.save()
  context.globalCompositeOperation = 'lighter'
  const y = 22 * cloud.depth

  if (style === 'star-sigil') {
    for (let ring = 0; ring < 3; ring++) {
      context.strokeStyle = rgba(cloud.color, .54 - ring * .12)
      context.lineWidth = .8
      polygon(context, focus, y, 13 + ring * 11, ring === 1 ? 6 : 8, time * .00035 * (ring % 2 ? -1 : 1))
      context.stroke()
    }
  } else if (style === 'cyber-eye') {
    context.strokeStyle = rgba(cloud.color, .74)
    context.beginPath()
    context.moveTo(focus - 72, y)
    context.quadraticCurveTo(focus, y - 26, focus + 72, y)
    context.quadraticCurveTo(focus, y + 26, focus - 72, y)
    context.stroke()
    context.fillStyle = rgba(cloud.color, .76)
    context.beginPath()
    context.ellipse(focus, y, 7 + Math.sin(time * .002) * 2, 15, 0, 0, Math.PI * 2)
    context.fill()
  } else if (style === 'manga-burst') {
    const lines = Math.max(12, cloud.particles)
    for (let line = 0; line < lines; line++) {
      const angle = line * Math.PI * 2 / lines
      const inner = 15 + seeded(line, 2) * 8
      const outer = 48 + seeded(line, 4) * 78
      context.strokeStyle = rgba(cloud.color, .22 + seeded(line, 5) * .5)
      context.beginPath()
      context.moveTo(focus + Math.cos(angle) * inner, y + Math.sin(angle) * inner * .35)
      context.lineTo(focus + Math.cos(angle) * outer, y + Math.sin(angle) * outer * .35)
      context.stroke()
    }
  } else if (style === 'sakura-blade') {
    for (let blade = 0; blade < cloud.strands; blade++) {
      const offset = (blade - cloud.strands / 2) * 5
      context.strokeStyle = rgba(cloud.color, .66 - blade * .05)
      context.lineWidth = 1.2
      context.beginPath()
      context.moveTo(width * .08, 5 + blade)
      context.quadraticCurveTo(focus - 40, 4 + offset, focus + 22, y + offset * .25)
      context.quadraticCurveTo(focus + 90, y - 8, width * .92, 2 + blade)
      context.stroke()
    }
  } else {
    for (let plate = 0; plate < 8; plate++) {
      const side = plate % 2 ? 1 : -1
      const distance = 18 + Math.floor(plate / 2) * 22
      context.fillStyle = rgba(cloud.color, .18 + (3 - Math.floor(plate / 2)) * .09)
      context.beginPath()
      context.moveTo(focus + side * 8, y)
      context.lineTo(focus + side * distance, 4 + plate * 2)
      context.lineTo(focus + side * (distance + 18), 8 + plate * 2)
      context.lineTo(focus + side * 16, y + 8)
      context.closePath()
      context.fill()
    }
    glow(context, focus, y, 42, cloud.color, .26)
  }
  context.restore()
  particles(frame, cloud.particles)
}

function drawBloom(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rotation: number,
  petals: number,
  color: string,
  alpha: number,
  notched: boolean
) {
  context.save()
  context.translate(x, y)
  context.rotate(rotation)
  for (let petal = 0; petal < petals; petal++) {
    context.save()
    context.rotate(petal * Math.PI * 2 / petals)
    const gradient = context.createLinearGradient(0, 0, 0, -radius)
    gradient.addColorStop(0, rgba(color, alpha * .58))
    gradient.addColorStop(1, rgba(color, alpha))
    context.fillStyle = gradient
    context.beginPath()
    context.moveTo(0, radius * .08)
    context.bezierCurveTo(-radius * .56, -radius * .2, -radius * .54, -radius * .72, -radius * .2, -radius)
    if (notched) {
      context.quadraticCurveTo(-radius * .08, -radius * 1.08, 0, -radius * .86)
      context.quadraticCurveTo(radius * .08, -radius * 1.08, radius * .2, -radius)
    } else {
      context.quadraticCurveTo(0, -radius * 1.12, radius * .2, -radius)
    }
    context.bezierCurveTo(radius * .54, -radius * .72, radius * .56, -radius * .2, 0, radius * .08)
    context.fill()
    context.restore()
  }
  context.fillStyle = rgba(color, alpha)
  context.beginPath()
  context.arc(0, 0, radius * .23, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawNature(frame: Frame) {
  const { context, width, height, time, cloud, focus } = frame
  const petals = cloud.shape === 'osmanthus-bloom' ? 4 : 5
  const notched = cloud.shape === 'cherry-bloom'
  const amount = Math.max(1, cloud.particles)
  for (let index = 0; index < amount; index++) {
    const progress = (time * (.000038 + seeded(index, 3) * .000025) + seeded(index, 9)) % 1
    const spread = (seeded(index, 5) - .5) * width * .78
    const x = focus + spread * (1 - progress * .2) + Math.sin(time * .001 + index) * 9
    const y = -8 + progress * (height + 18)
    const radius = (cloud.shape === 'osmanthus-bloom' ? 4.2 : 6.2) + seeded(index, 7) * 2.1
    drawBloom(context, x, y, radius, time * (.00022 + seeded(index, 2) * .0002), petals, cloud.color, Math.sin(progress * Math.PI) * .88, notched)
  }
  glow(context, focus, 14 * cloud.depth, 62, cloud.color, .1)
}

export function drawTriggerPreset(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  cloud: FluidCloudSettings,
  pointerX = width / 2
) {
  context.clearRect(0, 0, width, height)
  const preset = triggerPresets[cloud.shape]
  if (!preset || classicTriggerStyles.includes(cloud.shape)) return
  const focus = width / 2 + (pointerX - width / 2) * .18 * cloud.response
  const frame = { context, width, height, time: time * cloud.speed, cloud, focus }
  context.save()
  if (preset.category === 'fluid') drawFluid(frame)
  else if (preset.category === 'interface') drawInterface(frame)
  else if (preset.category === 'game') drawGame(frame)
  else if (preset.category === 'anime') drawAnime(frame)
  else drawNature(frame)
  context.restore()
}

export function TriggerCanvas({ cloud, active = true, animated = true, pointerResponsive = true, className = '' }: TriggerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerX = useRef<number | null>(null)
  const cloudRef = useRef(cloud)
  cloudRef.current = cloud

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || classicTriggerStyles.includes(cloud.shape)) return
    const context = canvas.getContext('2d')
    if (!context) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let disposed = false
    const handlePointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      pointerX.current = event.clientX >= bounds.left && event.clientX <= bounds.right
        ? event.clientX - bounds.left
        : null
    }
    if (active && animated && pointerResponsive) window.addEventListener('pointermove', handlePointer, { passive: true })

    const render = (time: number) => {
      if (disposed) return
      frame = 0
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      const pixelWidth = Math.round(width * ratio)
      const pixelHeight = Math.round(height * ratio)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      drawTriggerPreset(context, width, height, time, cloudRef.current, pointerX.current ?? width / 2)
      if (active && animated && !reducedMotion && document.visibilityState === 'visible') frame = requestAnimationFrame(render)
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (!frame && active && animated && !reducedMotion) frame = requestAnimationFrame(render)
      } else {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }
    if (!reducedMotion && active && animated && document.visibilityState === 'visible') {
      frame = requestAnimationFrame(render)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pointermove', handlePointer)
    }
  }, [active, animated, pointerResponsive])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || classicTriggerStyles.includes(cloud.shape)) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (active && animated && !reducedMotion) return
    const context = canvas.getContext('2d')
    if (!context) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawTriggerPreset(context, width, height, 0, cloud, width / 2)
  }, [
    active,
    animated,
    cloud.shape,
    cloud.color,
    cloud.strands,
    cloud.particles,
    cloud.speed,
    cloud.response,
    cloud.widthScale,
    cloud.heightScale,
    cloud.depth,
    cloud.curvature,
    cloud.symmetry
  ])

  return (
    <canvas ref={canvasRef} className={`triggerCanvas ${className}`} aria-hidden />
  )
}
