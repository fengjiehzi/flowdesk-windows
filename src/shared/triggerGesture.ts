export const triggerStyles = [
  'liquid-ridge',
  'magnetic-rail',
  'edge-dock',
  'quantum-membrane',
  'condensate-core',
  'ion-waterfall',
  'phase-fold',
  'vortex-gate',
  'plasma-fluid',
  'liquid-glass',
  'fluent-material',
  'material-morph',
  'live-activity',
  'contextual-bar',
  'dot-matrix',
  'overclock-reactor',
  'cyber-dragon',
  'tactical-shield',
  'void-rift',
  'warp-pulse',
  'nano-armor',
  'sakura-blade',
  'mecha-awaken',
  'star-sigil',
  'cyber-eye',
  'manga-burst',
  'cherry-bloom',
  'plum-bloom',
  'peach-bloom',
  'pear-bloom',
  'osmanthus-bloom'
] as const

export type TriggerStyle = (typeof triggerStyles)[number]
export type TriggerPresetCategory = 'classic' | 'fluid' | 'interface' | 'game' | 'anime' | 'nature'
export type FluxPalette = readonly [string, string, string]

export type TriggerPresetDefinition = {
  id: TriggerStyle
  name: string
  category: TriggerPresetCategory
  colors: FluxPalette
  speed: number
  response: number
  noiseScale: number
  depth: number
  curvature: number
}

export const triggerPresetCategories: ReadonlyArray<{ id: TriggerPresetCategory; name: string }> = [
  { id: 'classic', name: '经典流云' },
  { id: 'fluid', name: '流体材质' },
  { id: 'interface', name: '实时界面' },
  { id: 'game', name: '游戏科技' },
  { id: 'anime', name: '动感二次元' },
  { id: 'nature', name: '花卉自然' }
]

function hslToHex(hue: number, saturation: number, lightness: number) {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return `#${[channel(0), channel(8), channel(4)].map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`
}

export function deriveFluxPalette(color: string): [string, string, string] {
  const value = color.replace('#', '')
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  let hue = 0
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  hue = (hue + 360) % 360
  const normalize = (value: string) => value.toUpperCase()
  return [
    normalize(`#${color.replace('#', '').toUpperCase()}`),
    normalize(hslToHex((hue + 42) % 360, Math.min(1, saturation * 1.04), Math.min(.72, lightness + .04))),
    normalize(hslToHex((hue + 308) % 360, Math.min(1, saturation * 1.08), Math.max(.25, lightness - .02)))
  ]
}

const preset = (
  id: TriggerStyle,
  name: string,
  category: TriggerPresetCategory,
  color: string,
  speed = 1,
  response = 1,
  colors: FluxPalette = deriveFluxPalette(color),
  noiseScale = 1.2,
  depth = 1,
  curvature = .55
): TriggerPresetDefinition => ({ id, name, category, colors, speed, response, noiseScale, depth, curvature })

export const triggerPresets: Record<TriggerStyle, TriggerPresetDefinition> = {
  'liquid-ridge': preset('liquid-ridge', '液态悬脊', 'classic', '#59D6FF', 1, 1, ['#59D6FF', '#34D399', '#8B5CF6']),
  'magnetic-rail': preset('magnetic-rail', '磁轨流云', 'classic', '#59D6FF', .9, 1.1),
  'edge-dock': preset('edge-dock', '顶沿浮舱', 'classic', '#59D6FF', .72, .8),
  'quantum-membrane': preset('quantum-membrane', '量子能量膜', 'fluid', '#14E094', .9, 1, ['#14E094', '#2E7AFF', '#8C40F2']),
  'condensate-core': preset('condensate-core', '凝聚云核', 'fluid', '#63F5D0', .8, 1.2),
  'ion-waterfall': preset('ion-waterfall', '离子瀑流', 'fluid', '#5BA9FF', 1.1),
  'phase-fold': preset('phase-fold', '相位折叠云', 'fluid', '#A77BFF', .75),
  'vortex-gate': preset('vortex-gate', '星门涡流', 'fluid', '#6CDFFF', .85),
  'plasma-fluid': preset('plasma-fluid', '液态等离子', 'fluid', '#B662FF', 1.25),
  'liquid-glass': preset('liquid-glass', '液态玻璃', 'fluid', '#212121', .65, 1, ['#212121', '#8C8C8C', '#D1D1D1']),
  'fluent-material': preset('fluent-material', 'Fluent 材质', 'fluid', '#6BBDFF', .7),
  'material-morph': preset('material-morph', 'Material 形变', 'fluid', '#FF78B7', .9),
  'live-activity': preset('live-activity', '实时活动胶囊', 'interface', '#62E5FF', .65),
  'contextual-bar': preset('contextual-bar', '状态信息带', 'interface', '#70DCA0', .55),
  'dot-matrix': preset('dot-matrix', '点阵极简', 'interface', '#8DD8FF', .8),
  'overclock-reactor': preset('overclock-reactor', '超频反应堆', 'game', '#002EA6', 1.2, 1.25, ['#002EA6', '#2140D9', '#FF5C1F']),
  'cyber-dragon': preset('cyber-dragon', '赛博龙脊', 'game', '#64F4D5', 1.05),
  'tactical-shield': preset('tactical-shield', '战术护盾', 'game', '#55B9FF', .8),
  'void-rift': preset('void-rift', '虚空裂隙', 'game', '#B46CFF', .95, 1.2),
  'warp-pulse': preset('warp-pulse', '跃迁脉冲', 'game', '#63E7FF', 1.4, 1.3),
  'nano-armor': preset('nano-armor', '纳米装甲', 'game', '#90E8FF', 1.05),
  'sakura-blade': preset('sakura-blade', '霓虹樱刃', 'anime', '#FF78C8', 1.35),
  'mecha-awaken': preset('mecha-awaken', '机甲觉醒', 'anime', '#FF5E50', 1.15),
  'star-sigil': preset('star-sigil', '星术魔法阵', 'anime', '#7A3DFF', .9, 1, ['#7A3DFF', '#B8D43D', '#4D2BA1']),
  'cyber-eye': preset('cyber-eye', '赛博神瞳', 'anime', '#59E6FF', .8, 1.3),
  'manga-burst': preset('manga-burst', '漫画爆发', 'anime', '#FFDB58', 1.45),
  'cherry-bloom': preset('cherry-bloom', '樱花粉流云', 'nature', '#FF4F9E', .8, 1, ['#FF4F9E', '#FF8C40', '#B83DFF']),
  'plum-bloom': preset('plum-bloom', '梅花绛云', 'nature', '#D84F72', .7),
  'peach-bloom': preset('peach-bloom', '桃花珊瑚云', 'nature', '#F28B7F', .75),
  'pear-bloom': preset('pear-bloom', '梨花月白云', 'nature', '#E8F5EE', .65),
  'osmanthus-bloom': preset('osmanthus-bloom', '桂花鎏金云', 'nature', '#FFB82E', .9, 1, ['#FFB82E', '#FF5747', '#9E2470'])
}

export const defaultTriggerStyle: TriggerStyle = 'liquid-ridge'
