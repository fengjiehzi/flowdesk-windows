export const triggerPullThreshold = 6
export const triggerClickTolerance = 2
export const triggerAxisLockThreshold = 4
export const triggerSideMargin = 12

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

export type TriggerPresetDefinition = {
  id: TriggerStyle
  name: string
  category: TriggerPresetCategory
  width: number
  height: number
  color: string
  strands: number
  particles: number
  speed: number
  response: number
}

export const triggerPresetCategories: ReadonlyArray<{ id: TriggerPresetCategory; name: string }> = [
  { id: 'classic', name: '经典把手' },
  { id: 'fluid', name: '流体材质' },
  { id: 'interface', name: '实时界面' },
  { id: 'game', name: '游戏科技' },
  { id: 'anime', name: '动感二次元' },
  { id: 'nature', name: '花卉自然' }
]

const preset = (
  id: TriggerStyle,
  name: string,
  category: TriggerPresetCategory,
  width: number,
  color: string,
  strands = 5,
  particles = 8,
  speed = 1,
  response = 1,
  height = category === 'classic' ? 30 : 86
): TriggerPresetDefinition => ({ id, name, category, width, height, color, strands, particles, speed, response })

export const triggerPresets: Record<TriggerStyle, TriggerPresetDefinition> = {
  'liquid-ridge': preset('liquid-ridge', '液态悬脊', 'classic', 212, '#59d6ff'),
  'magnetic-rail': preset('magnetic-rail', '磁轨流云', 'classic', 320, '#59d6ff'),
  'edge-dock': preset('edge-dock', '顶沿浮舱', 'classic', 640, '#59d6ff'),
  'quantum-membrane': preset('quantum-membrane', '量子能量膜', 'fluid', 560, '#5de7ff', 7, 10, .9),
  'condensate-core': preset('condensate-core', '凝聚云核', 'fluid', 320, '#63f5d0', 5, 12, .8, 1.2),
  'ion-waterfall': preset('ion-waterfall', '离子瀑流', 'fluid', 440, '#5ba9ff', 6, 14, 1.1),
  'phase-fold': preset('phase-fold', '相位折叠云', 'fluid', 500, '#a77bff', 6, 8, .75),
  'vortex-gate': preset('vortex-gate', '星门涡流', 'fluid', 460, '#6cdfff', 5, 10, .85),
  'plasma-fluid': preset('plasma-fluid', '液态等离子', 'fluid', 560, '#b662ff', 8, 13, 1.25),
  'liquid-glass': preset('liquid-glass', '液态玻璃', 'fluid', 500, '#bcefff', 4, 6, .65),
  'fluent-material': preset('fluent-material', 'Fluent 材质', 'fluid', 520, '#6bbdff', 4, 8, .7),
  'material-morph': preset('material-morph', 'Material 形变', 'fluid', 460, '#ff78b7', 5, 8, .9),
  'live-activity': preset('live-activity', '实时活动胶囊', 'interface', 360, '#62e5ff', 3, 5, .65),
  'contextual-bar': preset('contextual-bar', '状态信息带', 'interface', 560, '#70dca0', 3, 4, .55),
  'dot-matrix': preset('dot-matrix', '点阵极简', 'interface', 480, '#8dd8ff', 2, 16, .8),
  'overclock-reactor': preset('overclock-reactor', '超频反应堆', 'game', 420, '#ff7a45', 6, 12, 1.2, 1.25),
  'cyber-dragon': preset('cyber-dragon', '赛博龙脊', 'game', 520, '#64f4d5', 5, 12, 1.05),
  'tactical-shield': preset('tactical-shield', '战术护盾', 'game', 500, '#55b9ff', 5, 10, .8),
  'void-rift': preset('void-rift', '虚空裂隙', 'game', 400, '#b46cff', 7, 9, .95, 1.2),
  'warp-pulse': preset('warp-pulse', '跃迁脉冲', 'game', 620, '#63e7ff', 6, 14, 1.4, 1.3),
  'nano-armor': preset('nano-armor', '纳米装甲', 'game', 520, '#90e8ff', 5, 16, 1.05),
  'sakura-blade': preset('sakura-blade', '霓虹樱刃', 'anime', 560, '#ff78c8', 6, 13, 1.35),
  'mecha-awaken': preset('mecha-awaken', '机甲觉醒', 'anime', 500, '#ff5e50', 6, 10, 1.15),
  'star-sigil': preset('star-sigil', '星术魔法阵', 'anime', 460, '#a987ff', 6, 12, .9),
  'cyber-eye': preset('cyber-eye', '赛博神瞳', 'anime', 420, '#59e6ff', 5, 9, .8, 1.3),
  'manga-burst': preset('manga-burst', '漫画爆发', 'anime', 620, '#ffdb58', 7, 14, 1.45),
  'cherry-bloom': preset('cherry-bloom', '樱花粉流云', 'nature', 560, '#f58db8', 2, 10, .8),
  'plum-bloom': preset('plum-bloom', '梅花绛云', 'nature', 500, '#d84f72', 2, 9, .7),
  'peach-bloom': preset('peach-bloom', '桃花珊瑚云', 'nature', 540, '#f28b7f', 2, 10, .75),
  'pear-bloom': preset('pear-bloom', '梨花月白云', 'nature', 520, '#e8f5ee', 2, 9, .65),
  'osmanthus-bloom': preset('osmanthus-bloom', '桂花鎏金云', 'nature', 480, '#f5b43f', 2, 12, .9)
}

export const classicTriggerStyles = triggerStyles.slice(0, 3) as readonly TriggerStyle[]
export const defaultTriggerStyle: TriggerStyle = 'liquid-ridge'
export const triggerStyleDimensions = Object.fromEntries(
  triggerStyles.map((style) => [style, { width: triggerPresets[style].width, height: triggerPresets[style].height }])
) as Record<TriggerStyle, { width: number; height: number }>

export type TriggerGestureAxis = 'horizontal' | 'vertical'
export const triggerMovePhases = ['start', 'move', 'end', 'cancel'] as const
export type TriggerMovePhase = (typeof triggerMovePhases)[number]
export type TriggerVisualLayout = { focusX: number; pullDistance: number; style: TriggerStyle }

export function resolveTriggerGestureAxis(deltaX: number, deltaY: number): TriggerGestureAxis | null {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < triggerAxisLockThreshold) return null
  return Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical'
}

export function triggerActivationLeft(workAreaX: number, workAreaWidth: number, activationWidth: number) {
  return Math.round(workAreaX + (workAreaWidth - activationWidth) / 2)
}

export function triggerLeftFromPosition(workAreaX: number, workAreaWidth: number, contentWidth: number, position: number) {
  const track = Math.max(0, workAreaWidth - contentWidth - triggerSideMargin * 2)
  const clampedPosition = Math.max(0, Math.min(1, position))
  return Math.round(workAreaX + triggerSideMargin + track * clampedPosition)
}

export function triggerPositionFromLeft(workAreaX: number, workAreaWidth: number, contentWidth: number, left: number) {
  const track = Math.max(0, workAreaWidth - contentWidth - triggerSideMargin * 2)
  if (track === 0) return 0.5
  return Math.max(0, Math.min(1, (left - workAreaX - triggerSideMargin) / track))
}

export function shouldRevealFromTrigger(pullDistance: number, travelDistance: number) {
  return pullDistance >= triggerPullThreshold || travelDistance <= triggerClickTolerance
}
