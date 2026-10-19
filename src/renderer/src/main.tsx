import React, { Component, useEffect, ErrorInfo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Check,
  ChevronUp,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe2,
  GripVertical,
  Library,
  Link2,
  MonitorDown,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Trash2,
  Undo2,
  Waves,
  X,
} from 'lucide-react'
import { applySettingsPatch, defaultSettings, type FluidCloudCreation, type FluidCloudSettings, type IslandSettings, type IslandSettingsPatch } from '../../shared/settings'
import { isSurfaceActive, type IslandSurface } from '../../shared/islandPresentation'
import { launcherNameSchema, maxLauncherEntries, normalizeWebsiteUrl, type InstalledAppCandidate, type LauncherEntryView, type LauncherState } from '../../shared/launcher'
import type { NotificationCenterState, NotificationSource, SystemNotificationItem } from '../../shared/notifications'
import {
  triggerPresetCategories,
  triggerPresets,
  triggerStyles,
  type TriggerStyle
} from '../../shared/triggerGesture'
import type { IslandSnapshot } from '../../shared/types'
import { FluxCanvas } from './fluxCanvas'
import { SettingsPersistence, type SaveStatus } from './settingsPersistence'
import { LauncherWorkspace } from './LauncherWorkspace'
import { LocalLaunchManager } from './LocalLaunchManager'
import './styles.css'

type ErrorBoundaryProps = { children: React.ReactNode }
type ErrorBoundaryState = { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="errorBoundary">
          <h2>组件出错</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>重试</button>
        </div>
      )
    }
    return this.props.children
  }
}

const surfaceParameter = new URLSearchParams(window.location.search).get('surface')
const previewVariant = new URLSearchParams(window.location.search).get('variant')
type RendererSurface = IslandSurface | 'creator' | 'settings' | 'launcher'
const requestedSurface: RendererSurface | null = surfaceParameter === 'compact' || surfaceParameter === 'panel' || surfaceParameter === 'creator' || surfaceParameter === 'settings' || surfaceParameter === 'launcher'
  ? surfaceParameter
  : null

const palettes = {
  graphite: ['#0b0d10', '#f3f5f7', '#52d273', '#06080b'],
  aurora: ['#07130f', '#f2fbf7', '#59d6a2', '#04100c'],
  ember: ['#170d09', '#fff6f0', '#e58a5b', '#0e0704'],
  cobalt: ['#07111f', '#f2f7ff', '#5ca7ed', '#030914'],
  plum: ['#140c19', '#faf5fb', '#bd82c9', '#09050c'],
  citrus: ['#111308', '#fafde9', '#b6d45f', '#080904'],
  slate: ['#11151b', '#f5f7fa', '#7fa6c9', '#070a0f'],
  rose: ['#190e13', '#fff5f7', '#dd7899', '#0d0609']
} as const

type SurfacePalette = (typeof palettes)[keyof typeof palettes]

function fluxSurfaceColors(palette: SurfacePalette) {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(palette[3].slice(offset, offset + 2), 16) / 255)
  const luminance = rgb.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
  return luminance > .55
    ? { baseColor: '#FAFAFA', mistColor: '#FFFFFF' }
    : { baseColor: palette[3], mistColor: palette[1] }
}

const previewSnapshot: IslandSnapshot = {
  state: surfaceParameter === 'panel' ? 'EXPANDED' : 'COMPACT',
  compactMode: previewVariant === 'B' ? 'notification' : 'clock',
  settings: defaultSettings,
  now: new Date().toISOString(),
  settingsRevision: 0
}

const previewLauncherState: LauncherState = {
  setupCompleted: false,
  localEntries: [],
  recentEntries: [],
  entries: window.island ? [] : [
    { id: 'd194efb4-55a3-47dc-a2ef-c472caeb490c', kind: 'app', name: '文件资源管理器' },
    { id: '0130baba-18a9-4ebd-aa3a-3e4f70a0c804', kind: 'app', name: '记事本' },
    { id: '22f374f8-0a46-42e2-97cf-77f9ab2bb88d', kind: 'app', name: 'Visual Studio Code' },
    { id: '951bf1c1-938e-4863-8927-7555e47a80e0', kind: 'website', name: '工作台' }
  ]
}
if (!window.island && previewVariant === 'capacity') {
  previewLauncherState.entries.push(...['演示入口五', '演示入口六', '演示入口七', '演示入口八'].map((name, index) => ({
    id: `capacity-preview-${index}`, kind: 'website' as const, name
  })))
}
if (!window.island && previewVariant === 'empty') previewLauncherState.entries = []

const previewNotificationState: NotificationCenterState = {
  accessStatus: 'disabled',
  enabled: false,
  suppression: 'accepts',
  bridgeStatus: 'stopped',
  clipboardArchiveError: null,
  clipboardArchiveActive: false,
  unreadCount: window.island ? 0 : 2,
  sources: window.island ? [] : [{ id: 'preview-feishu', name: '飞书', muted: false }],
  desktopAdapters: [
    { id: 'desktop:feishu', name: '飞书', status: window.island ? 'disabled' : 'waiting' },
    { id: 'desktop:weixin', name: '微信', status: window.island ? 'disabled' : 'app-not-running' }
  ],
  items: window.island ? [] : [{
    id: 'preview-notification',
    platformId: 1,
    appId: 'preview-feishu',
    appName: '飞书',
    title: '林墨',
    body: '项目评审提前到 15:30，请看一下最新文档',
    createdAt: new Date().toISOString(),
    groupCount: 2,
    unreadCount: 2
  }]
}

const previewInstalledApps: InstalledAppCandidate[] = [
  { id: 'preview-explorer', name: '文件资源管理器', selectedEntryId: previewLauncherState.entries[0]?.id },
  { id: 'preview-notepad', name: '记事本', selectedEntryId: previewLauncherState.entries[1]?.id },
  { id: 'preview-vscode', name: 'Visual Studio Code', selectedEntryId: previewLauncherState.entries[2]?.id },
  { id: 'preview-terminal', name: 'Windows Terminal' },
  { id: 'preview-paint', name: '画图' },
  { id: 'preview-calculator', name: '计算器' }
]

type Feedback = { message: string; sequence: number; kind?: 'error' }

function useBridge(
  setSnapshot: React.Dispatch<React.SetStateAction<IslandSnapshot>>,
  setFeedback: React.Dispatch<React.SetStateAction<Feedback>>,
  persistence: SettingsPersistence
) {
  useEffect(() => {
    if (!window.island) {
      const id = window.setInterval(() => setSnapshot((current) => ({ ...current, now: new Date().toISOString() })), 1000)
      return () => window.clearInterval(id)
    }
    const receive = (value: IslandSnapshot) => setSnapshot({ ...value, settings: persistence.receive(value.settings, value.settingsRevision) })
    window.island.getSnapshot().then(receive).catch(() => {
      setFeedback((current) => ({ message: '无法连接桌面服务', kind: 'error', sequence: current.sequence + 1 }))
    })
    return window.island.onSnapshot(receive)
  }, [setFeedback, setSnapshot, persistence])
}

function useLauncherBridge(
  setLauncherState: React.Dispatch<React.SetStateAction<LauncherState>>,
  setFeedback: React.Dispatch<React.SetStateAction<Feedback>>
) {
  useEffect(() => {
    if (!window.island) return
    window.island.getLauncherState().then(setLauncherState).catch(() => {
      setFeedback((current) => ({ message: '无法读取快捷入口', kind: 'error', sequence: current.sequence + 1 }))
    })
    return window.island.onLauncherState(setLauncherState)
  }, [setFeedback, setLauncherState])
}

function useNotificationBridge(
  setState: React.Dispatch<React.SetStateAction<NotificationCenterState>>,
  setFeedback: React.Dispatch<React.SetStateAction<Feedback>>
) {
  useEffect(() => {
    if (!window.island) return
    window.island.getNotificationState().then(setState).catch(() => {
      setFeedback((current) => ({ message: '无法读取系统通知', kind: 'error', sequence: current.sequence + 1 }))
    })
    return window.island.onNotificationState(setState)
  }, [setFeedback, setState])
}

function formatDate(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 星期${'日一二三四五六'[date.getDay()]}`
}

function ShortcutIcon({ entry, size = 22 }: { entry: Pick<LauncherEntryView, 'kind' | 'icon'>; size?: number }) {
  if (entry.icon) return <img className="shortcutImage" src={entry.icon} alt="" />
  return entry.kind === 'website' ? <Globe2 size={size} /> : <AppWindow size={size} />
}

function CloudBackdrop({ cloud, palette, active = true }: { cloud: FluidCloudSettings; palette: SurfacePalette; active?: boolean }) {
  const colors = fluxSurfaceColors(palette)
  return (
    <span className="cloudBackdrop" aria-hidden>
      <FluxCanvas cloud={cloud} active={active} className="cloudBackdropArt" {...colors} />
    </span>
  )
}

function cloudFromPreset(style: TriggerStyle): FluidCloudSettings {
  const preset = triggerPresets[style]
  return {
    shape: style,
    color: preset.colors[0],
    secondaryColor: preset.colors[1],
    tertiaryColor: preset.colors[2],
    speed: preset.speed,
    response: preset.response,
    noiseScale: preset.noiseScale,
    depth: preset.depth,
    curvature: preset.curvature
  }
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onEditStart,
  onEditEnd
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display?: string
  onChange: (value: number) => void
  onEditStart?: () => void
  onEditEnd?: () => void
}) {
  const finishKeyboardEdit = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      onEditEnd?.()
    }
  }

  return (
    <div className="studioField">
      <span>{label}<output>{display ?? value.toFixed(step < 1 ? 2 : 0)}</output></span>
      <span className="studioFieldControls">
        <input
          type="range"
          aria-label={`${label}滑杆`}
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={onEditStart}
          onPointerUp={onEditEnd}
          onPointerCancel={onEditEnd}
          onKeyDown={onEditStart}
          onKeyUp={finishKeyboardEdit}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          className="studioNumber"
          aria-label={`${label}数值`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))}
        />
      </span>
    </div>
  )
}

function sameCloud(left: FluidCloudSettings | null, right: FluidCloudSettings) {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right)
}

function NotificationIcon({ item }: { item: { icon?: string; name: string; appName?: string } }) {
  if (item.icon) return <img src={item.icon} alt="" />
  return <span>{(item.appName ?? item.name).slice(0, 1)}</span>
}

function NotificationPreview({ state, settings }: { state: NotificationCenterState; settings: IslandSettings }) {
  const item = state.items[0]
  if (!item) return null
  const palette = palettes[settings.theme]
  return (
    <button
      className="notificationPreview capsuleNotification"
      type="button"
      onMouseEnter={() => window.island?.setNotificationPreviewHovered(true)}
      onMouseLeave={() => window.island?.setNotificationPreviewHovered(false)}
      onClick={() => window.island?.openPanel('notifications')}
      aria-label={`打开 ${item.appName} 通知`}
    >
      <CloudBackdrop cloud={settings.fluidCloud} palette={palette} />
      <span className="notificationAppIcon"><NotificationIcon item={{ ...item, name: item.appName }} /></span>
      <span className="notificationCopy">
        <span><b>{item.title || item.appName}</b><small>{item.appName}</small></span>
        {settings.showNotificationPreview && <em>{item.body || '收到一条新通知'}</em>}
      </span>
      {item.groupCount > 1 && <span className="notificationCount">+{item.groupCount - 1}</span>}
    </button>
  )
}

const fluxPreviewSurfaces = {
  compact: { label: '小胶囊', width: 148, height: 40, previewWidth: 296 },
  notification: { label: '通知胶囊', width: 430, height: 68, previewWidth: 430 },
  panel: { label: '展开面板', width: 784, height: 464, previewWidth: 300 }
} as const
type FluxPreviewSurface = keyof typeof fluxPreviewSurfaces

function CloudStudio({
  settings,
  onCloudChange,
  onCreationsChange,
  notify,
  setCloseGuard,
  saveStatus,
  onRetrySave
}: {
  settings: IslandSettings
  onCloudChange: (patch: Partial<FluidCloudSettings>) => void
  onCreationsChange: (creations: FluidCloudCreation[]) => Promise<boolean>
  notify: (message: string) => void
  setCloseGuard: (guard: () => boolean) => void
  saveStatus: SaveStatus
  onRetrySave: () => void
}) {
  const { fluidCloud: cloud, fluidCloudCreations: creations } = settings
  const fluxColors = fluxSurfaceColors(palettes[settings.theme])
  const [category, setCategory] = useState(triggerPresets[cloud.shape].category)
  const [creationName, setCreationName] = useState(`${triggerPresets[cloud.shape].name} 自定义`.slice(0, 24))
  const [activeCreationId, setActiveCreationId] = useState<string | null>(null)
  const [savedCloud, setSavedCloud] = useState<FluidCloudSettings | null>(null)
  const [undoStack, setUndoStack] = useState<FluidCloudSettings[]>([])
  const [redoStack, setRedoStack] = useState<FluidCloudSettings[]>([])
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [creationError, setCreationError] = useState<string | null>(null)
  const creationBusy = useRef(false)
  const pendingCreationId = useRef<string | null>(null)
  const [previewSurface, setPreviewSurface] = useState<FluxPreviewSurface>('compact')
  const [windowInteraction, setWindowInteraction] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const libraryRef = useRef<HTMLDialogElement>(null)
  const libraryButtonRef = useRef<HTMLButtonElement>(null)
  const cloudRef = useRef(cloud)
  const newCreationBaseline = useRef({ cloud, name: creationName })
  const editStart = useRef<FluidCloudSettings | null>(null)
  cloudRef.current = cloud
  useEffect(() => window.island?.onCreatorWindowInteraction(setWindowInteraction), [])
  useEffect(() => {
    const dialog = libraryRef.current
    if (libraryOpen && dialog && !dialog.open) dialog.showModal()
    else if (!libraryOpen && dialog?.open) dialog.close()
  }, [libraryOpen])
  const visiblePresets = triggerStyles.filter((style) => triggerPresets[style].category === category)
  const activePreset = triggerPresets[cloud.shape]
  const preview = fluxPreviewSurfaces[previewSurface]
  const activeCreation = creations.find((creation) => creation.id === activeCreationId)
  const dirty = !sameCloud(savedCloud, cloud) || (activeCreation ? activeCreation.name !== creationName.trim() : true)
  const hasUnsavedWork = activeCreationId ? dirty : !sameCloud(newCreationBaseline.current.cloud, cloud) || newCreationBaseline.current.name !== creationName
  const confirmDiscard = () => !hasUnsavedWork || window.confirm('当前方案有未保存的修改。放弃方案修改并继续？已应用的流云设置会保留。')
  useEffect(() => {
    setCloseGuard(confirmDiscard)
    return () => setCloseGuard(() => true)
  }, [hasUnsavedWork, setCloseGuard])

  const persistCreations = async (next: FluidCloudCreation[]) => {
    if (creationBusy.current) return false
    creationBusy.current = true
    setSaving(true)
    setCreationError(null)
    try { return await onCreationsChange(next) }
    finally { creationBusy.current = false; setSaving(false) }
  }

  const remember = (value: FluidCloudSettings) => {
    setUndoStack((current) => [...current.slice(-49), { ...value }])
    setRedoStack([])
  }

  const applyCloud = (patch: Partial<FluidCloudSettings>, record = true) => {
    const current = cloudRef.current
    const next = { ...current, ...patch }
    if (sameCloud(current, next)) return
    if (record) remember(current)
    cloudRef.current = next
    onCloudChange(next)
  }

  const beginEdit = () => {
    if (!editStart.current) editStart.current = { ...cloudRef.current }
  }

  const endEdit = () => {
    const before = editStart.current
    editStart.current = null
    if (before && !sameCloud(before, cloudRef.current)) remember(before)
  }

  const selectPreset = (style: TriggerStyle) => {
    setCategory(triggerPresets[style].category)
    applyCloud(cloudFromPreset(style))
  }

  const loadCreation = (creation: FluidCloudCreation) => {
    if (saving) return
    if (activeCreationId === creation.id) { setLibraryOpen(false); return }
    if (!confirmDiscard()) return
    setCategory(triggerPresets[creation.cloud.shape].category)
    pendingCreationId.current = null
    setActiveCreationId(creation.id)
    setCreationName(creation.name)
    setSavedCloud({ ...creation.cloud })
    applyCloud(creation.cloud)
    setLibraryOpen(false)
  }

  const startNewCreation = () => {
    if (saving || !confirmDiscard()) return
    const name = `${triggerPresets[cloudRef.current.shape].name} 自定义`.slice(0, 24)
    newCreationBaseline.current = { cloud: { ...cloudRef.current }, name }
    pendingCreationId.current = null
    setActiveCreationId(null)
    setSavedCloud(null)
    setCreationName(name)
    setLibraryOpen(false)
  }

  const saveCreation = async () => {
    if (saving) return
    const name = creationName.trim()
    if (!launcherNameSchema.safeParse(name).success) return setCreationError('请输入 1–24 个字符的方案名称')
    const createNew = !activeCreationId
    if (createNew && !pendingCreationId.current && creations.length >= 32) return setCreationError('方案目录最多保存 32 个方案')
    const id = createNew ? pendingCreationId.current ?? crypto.randomUUID() : activeCreationId
    if (createNew) pendingCreationId.current = id
    const nextCreation = { id, name, cloud: { ...cloudRef.current } }
    const nextCreations = createNew && !creations.some((creation) => creation.id === id)
      ? [...creations, nextCreation]
      : creations.map((creation) => creation.id === id ? nextCreation : creation)
    const saved = await persistCreations(nextCreations)
    if (!saved) return
    setActiveCreationId(id)
    pendingCreationId.current = null
    setSavedCloud({ ...nextCreation.cloud })
    notify(`已保存“${name}”`)
  }

  const duplicateCreation = async (creation: FluidCloudCreation) => {
    if (creations.length >= 32) return notify('方案目录最多保存 32 个方案')
    const name = `${creation.name} 副本`.slice(0, 24)
    if (await persistCreations([...creations, { id: crypto.randomUUID(), name, cloud: { ...creation.cloud } }])) {
      notify(`已复制“${creation.name}”`)
    }
  }

  const renameCreation = async (creation: FluidCloudCreation, value: string) => {
    const name = value.trim()
    if (!launcherNameSchema.safeParse(name).success) return setCreationError('请输入 1–24 个字符的方案名称')
    if (await persistCreations(creations.map((item) => item.id === creation.id ? { ...item, name } : item))) {
      if (activeCreationId === creation.id) setCreationName(name)
      setRenaming(null)
      notify(`已重命名为“${name}”`)
    }
  }

  const deleteCreation = async (creation: FluidCloudCreation) => {
    if (!window.confirm(`删除“${creation.name}”？`)) return
    if (await persistCreations(creations.filter((item) => item.id !== creation.id))) {
      if (activeCreationId === creation.id) {
        setActiveCreationId(null)
        setSavedCloud(null)
      }
      notify(`已删除“${creation.name}”`)
    }
  }

  const undo = () => {
    const previous = undoStack.at(-1)
    if (!previous) return
    const currentCloud = { ...cloudRef.current }
    setUndoStack((current) => current.slice(0, -1))
    setRedoStack((current) => [...current.slice(-49), currentCloud])
    cloudRef.current = previous
    onCloudChange(previous)
  }

  const redo = () => {
    const next = redoStack.at(-1)
    if (!next) return
    const currentCloud = { ...cloudRef.current }
    setRedoStack((current) => current.slice(0, -1))
    setUndoStack((current) => [...current.slice(-49), currentCloud])
    cloudRef.current = next
    onCloudChange(next)
  }

  return (
    <div className="studioShell">
      <header className="studioHeader">
        <div><h1>流云创作器</h1><p>选一组配色，调成喜欢的样子。</p></div>
        <div className="studioToolbar">
          <div className="studioHistory">
            <button type="button" onClick={undo} disabled={!undoStack.length} aria-label="撤销" title="撤销"><Undo2 size={16} /></button>
            <button type="button" onClick={redo} disabled={!redoStack.length} aria-label="重做" title="重做"><Redo2 size={16} /></button>
          </div>
          <button ref={libraryButtonRef} className="studioLibraryButton" type="button" aria-haspopup="dialog" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(true)}><FolderOpen size={16} />我的方案<span>{creations.length}</span></button>
        </div>
      </header>

      <section className="studioWorkspace" aria-label="效果与预设">
        <div className="studioPreview" aria-label="流云实时预览">
          <div className="studioPreviewHeading"><span>实时效果</span><small>{windowInteraction ? '移动窗口中 · 动画暂停' : '调整会即时应用到流屿桌面'}</small></div>
          <div className="studioPreviewModes" aria-label="预览外形">
            {(Object.keys(fluxPreviewSurfaces) as FluxPreviewSurface[]).map((surface) => (
              <button className={previewSurface === surface ? 'active' : ''} key={surface} type="button" aria-pressed={previewSurface === surface} onClick={() => setPreviewSurface(surface)}>{fluxPreviewSurfaces[surface].label}</button>
            ))}
          </div>
          <div className="studioPreviewCanvas">
            <div className={`studioPreviewArt preview-${previewSurface}`} style={{ width: `min(92%, ${preview.previewWidth}px)`, aspectRatio: `${preview.width} / ${preview.height}` }}>
              <FluxCanvas cloud={cloud} paused={windowInteraction} {...fluxColors} />
              {previewSurface === 'compact' && <span className="studioPreviewClock">12:00<span /></span>}
              {previewSurface === 'notification' && <span className="studioPreviewNotification"><Bell size={20} /><span><b>一条新通知</b><small>消息会在这里轻轻出现</small></span></span>}
              {previewSurface === 'panel' && <div className="studioPreviewPanel" aria-hidden><span>快捷入口<time>12:00</time></span><div>{Array.from({ length: 8 }, (_, index) => <i key={index}><AppWindow size={15} /></i>)}</div><footer>管理<span>创作</span><span>设置</span></footer></div>}
            </div>
          </div>
        </div>
        <div className="presetHeader"><h2>从喜欢的配色开始</h2><span>{activePreset.name}</span></div>
        <nav className="studioCategories" aria-label="预设分类">
          {triggerPresetCategories.map((item) => <button key={item.id} type="button" className={category === item.id ? 'active' : ''} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}
        </nav>
        <div className="presetGrid" aria-label="配色预设">
          {visiblePresets.map((style) => {
            const preset = triggerPresets[style]
            return <button className={`presetCard ${cloud.shape === style ? 'active' : ''}`} key={style} type="button" aria-pressed={cloud.shape === style} onClick={() => selectPreset(style)}>
              <span className="studioPresetSwatch" style={{ background: `linear-gradient(115deg, ${preset.colors[0]}, ${preset.colors[1]} 52%, ${preset.colors[2]})` }} />
              <span className="presetName">{preset.name}</span>{cloud.shape === style && <Check size={13} />}
            </button>
          })}
        </div>
      </section>

      <aside className="studioInspector" aria-label="流云调整">
        <div className="studioAdjustments">
          <div className="inspectorHeader"><h2>调整效果</h2><button type="button" onClick={() => selectPreset(cloud.shape)}><RotateCcw size={13} />恢复预设</button></div>
          <div className="studioColorFields">
            {([['主色', 'color'], ['辅色', 'secondaryColor'], ['点缀色', 'tertiaryColor']] as const).map(([label, key]) => <label className="studioColorField" key={key}>
              <input aria-label={label} type="color" value={cloud[key]} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => applyCloud({ [key]: event.target.value }, false)} />
              <span>{label}</span><output>{cloud[key].toUpperCase()}</output>
            </label>)}
          </div>
          <div className="studioSpeed"><RangeField label="流动速度" value={cloud.speed} min={.25} max={2} step={.05} display={`${cloud.speed.toFixed(2)}×`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(speed) => applyCloud({ speed }, false)} /><p>慢一点舒缓，快一点轻盈。</p></div>
          <details className="studioAdvanced"><summary>高级设置</summary><div>
            <RangeField label="纹理细节" value={cloud.noiseScale} min={.5} max={3} step={.05} display={cloud.noiseScale.toFixed(2)} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(noiseScale) => applyCloud({ noiseScale }, false)} />
            <RangeField label="扭曲程度" value={cloud.curvature} min={0} max={1} step={.05} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(curvature) => applyCloud({ curvature }, false)} />
            <RangeField label="色彩浓度" value={cloud.depth} min={.5} max={1.5} step={.05} display={`${Math.round(cloud.depth * 100)}%`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(depth) => applyCloud({ depth }, false)} />
            <RangeField label="鼠标响应速度" value={cloud.response} min={.2} max={1.5} step={.05} display={`${cloud.response.toFixed(2)}×`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(response) => applyCloud({ response }, false)} />
          </div></details>
        </div>
        <div className="studioSaveArea">
          <div className={`studioApplyStatus ${saveStatus}`} role="status" aria-live="polite">
            <span>{!window.island ? '预览模式 · 不写入本地' : saveStatus === 'error' ? '应用失败 · 修改已保留' : saveStatus === 'saving' ? '正在应用调整…' : '调整已应用到流屿桌面'}</span>
            {saveStatus === 'error' && <button type="button" onClick={onRetrySave}>重试</button>}
          </div>
          <label className="studioNameField"><span>方案名称<small>{dirty ? '方案尚未保存' : '方案已保存'}</small></span><input aria-label="方案名称" value={creationName} maxLength={24} onChange={(event) => setCreationName(event.target.value)} /></label>
          {creationError && <p className="fieldError" role="alert">{creationError}</p>}
          <button className="studioSaveButton" type="button" disabled={saving || !dirty} onClick={() => void saveCreation()}><Save size={15} />{saving ? '正在保存…' : '保存方案'}</button>
        </div>
      </aside>

      <dialog ref={libraryRef} className="studioLibraryDrawer" aria-labelledby="studio-library-title" onCancel={() => setLibraryOpen(false)} onClose={() => { setLibraryOpen(false); libraryButtonRef.current?.focus() }}>
        <header><div><h2 id="studio-library-title">我的方案</h2><p>{creations.length} / 32 个方案</p></div><button type="button" className="roundButton" aria-label="关闭我的方案" onClick={() => setLibraryOpen(false)}><X size={18} /></button></header>
        <button className="studioNewCreation" type="button" disabled={saving} onClick={startNewCreation}><Plus size={16} />新建方案</button>
        {creationError && <p className="fieldError" role="alert">{creationError}</p>}
        <div className="studioWorks">
          {creations.length === 0 ? <div className="studioLibraryEmpty"><FolderOpen size={28} /><b>把喜欢的效果留下来</b><p>调整配色后保存方案，下次可以直接使用。</p></div> : creations.map((creation) => <div className="studioWork" key={creation.id}>
            <button className={activeCreationId === creation.id ? 'active' : ''} type="button" disabled={saving} aria-pressed={activeCreationId === creation.id} onClick={() => loadCreation(creation)} title={`载入 ${creation.name}`}><span style={{ background: `linear-gradient(120deg, ${creation.cloud.color}, ${creation.cloud.secondaryColor}, ${creation.cloud.tertiaryColor})` }} />{creation.name}</button>
            {renaming?.id === creation.id ? <form className="studioRename" onSubmit={(event) => { event.preventDefault(); void renameCreation(creation, renaming.name) }}>
              <input aria-label={`新方案名称 ${creation.name}`} autoFocus maxLength={24} value={renaming.name} onChange={(event) => setRenaming({ id: creation.id, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(null) } }} />
              <button type="submit" disabled={saving} aria-label="确认重命名"><Check size={13} /></button><button type="button" disabled={saving} aria-label="取消重命名" onClick={() => setRenaming(null)}><X size={13} /></button>
            </form> : <div className="studioWorkActions">
              <button type="button" disabled={saving} onClick={() => { setCreationError(null); setRenaming({ id: creation.id, name: creation.name }) }} aria-label={`重命名 ${creation.name}`}>Aa</button>
              <button type="button" disabled={saving} onClick={() => duplicateCreation(creation)} aria-label={`复制 ${creation.name}`}><Copy size={14} /></button>
              <button type="button" disabled={saving} onClick={() => deleteCreation(creation)} aria-label={`删除 ${creation.name}`}><Trash2 size={14} /></button>
            </div>}
          </div>)}
        </div>
      </dialog>
    </div>
  )
}

function GeneralSettings({
  settings,
  notificationState,
  onSettingsChange,
  onRequestNotificationAccess,
  notify
}: {
  settings: IslandSettings
  notificationState: NotificationCenterState
  onSettingsChange: (patch: Partial<IslandSettings>) => void
  onRequestNotificationAccess: () => void
  notify: (message: string) => void
}) {
  const accessLabel = {
    disabled: '监听已关闭', unspecified: '等待 Windows 授权', allowed: '已授权，等待新通知',
    denied: 'Windows 已拒绝访问', unavailable: '通知组件缺失，请修复安装', error: '通知服务异常，可重试'
  }[notificationState.accessStatus]
  return (
    <div className="generalSettingsShell">
      <header className="generalSettingsHeader">
        <span><Settings size={22} /></span>
        <div><small>FLOWDESK</small><h1>通用设置</h1><p>管理流屿桌面行为、系统通知和剪贴板归档。</p></div>
      </header>
      <div className="generalSettingsBody">
        <section className="settingsCard inspectorGroup"><h3>流屿桌面行为</h3>
          <div className="shortcutSummary"><span><b>点击胶囊展开</b><small>胶囊显示后点击展开；鼠标移开后自动隐藏</small></span></div>
          <div className="shortcutSummary"><span><b>顶部边缘呼出</b><small>平时隐藏，在与胶囊位置对齐的屏幕顶部停留约 0.45 秒显示胶囊</small></span></div>
          <div className="shortcutSummary"><span><b>全局快捷键</b><small>在当前屏幕显示小胶囊</small></span><kbd>Ctrl + Alt + Space</kbd></div>
          <RangeField label="移开后的隐藏延迟" value={settings.hideDelayMs} min={300} max={3000} step={100} display={`${settings.hideDelayMs}ms`} onChange={(hideDelayMs) => onSettingsChange({ hideDelayMs })} />
        </section>

        <section className="settingsCard inspectorGroup notificationSettings"><h3>系统通知</h3>
          <label className="notificationToggle">
            <span><b>监听通知中心</b><small role="status">{accessLabel}</small></span>
            <input
              type="checkbox"
              checked={settings.notificationsEnabled}
              onChange={(event) => {
                if (event.target.checked) onRequestNotificationAccess()
                else onSettingsChange({ notificationsEnabled: false })
              }}
            />
          </label>
          <label className="notificationToggle compactToggle">
            <span><b>显示消息摘要</b><small>关闭后只显示发送者</small></span>
            <input type="checkbox" checked={settings.showNotificationPreview} onChange={(event) => onSettingsChange({ showNotificationPreview: event.target.checked })} />
          </label>
          <label className="notificationToggle compactToggle">
            <span><b>微信/飞书桌面弹窗</b><small>{settings.notificationsEnabled ? '仅读取新弹窗，内容只驻留内存' : '请先启用通知中心监听'}</small></span>
            <input
              type="checkbox"
              disabled={!settings.notificationsEnabled}
              checked={settings.desktopPopupNotificationsEnabled}
              onChange={(event) => onSettingsChange({ desktopPopupNotificationsEnabled: event.target.checked })}
            />
          </label>
          {settings.desktopPopupNotificationsEnabled && (
            <div className="desktopAdapterStatuses">
              {notificationState.desktopAdapters.map((adapter) => (
                <span key={adapter.id}>
                  <i className={`statusDot ${adapter.status}`} />
                  <b>{adapter.name}</b>
                  <small>{({
                    disabled: '未启用',
                    'app-not-running': '客户端未运行',
                    waiting: '等待通知弹窗',
                    capturing: '已捕获弹窗',
                    'integrity-mismatch': '权限级别不一致',
                    error: '监听异常'
                  })[adapter.status]}</small>
                </span>
              ))}
              <p>请在客户端开启新消息弹窗；飞书：头像 → 设置 → 通知。</p>
            </div>
          )}
          {notificationState.sources.length > 0 && (
            <div className="notificationSources">
              <span>按来源屏蔽</span>
              {notificationState.sources.map((source) => (
                <label key={source.id}>
                  <i><NotificationIcon item={source} /></i><b>{source.name}</b>
                  <input
                    type="checkbox"
                    checked={!source.muted}
                    onChange={(event) => onSettingsChange({
                      mutedNotificationApps: event.target.checked
                        ? settings.mutedNotificationApps.filter((item) => item.id !== source.id)
                        : [...settings.mutedNotificationApps.filter((item) => item.id !== source.id), { id: source.id, name: source.name }]
                    })}
                  />
                </label>
              ))}
            </div>
          )}
          {notificationState.accessStatus === 'denied' && <button className="notificationSettingsLink" type="button" onClick={() => window.island?.openNotificationSettings()}>打开 Windows 权限设置</button>}
          {settings.notificationsEnabled && ['error', 'unavailable', 'unspecified'].includes(notificationState.accessStatus) && <button className="notificationSettingsLink" type="button" onClick={onRequestNotificationAccess}>{notificationState.accessStatus === 'unspecified' ? '请求 Windows 授权' : '重试连接通知服务'}</button>}
        </section>

        <section className="settingsCard inspectorGroup clipboardArchiveSettings"><h3>剪贴板归档</h3>
          <label className="notificationToggle">
            <span><b>自动保存复制内容</b><small>记录所有剪贴板变化，可能包含敏感信息</small></span>
            <input type="checkbox" checked={settings.clipboardArchiveEnabled} onChange={(event) => onSettingsChange({ clipboardArchiveEnabled: event.target.checked })} />
          </label>
          <p className="archiveStatus" role="status">{!settings.clipboardArchiveEnabled ? '归档已关闭，已有文件会保留。' : notificationState.clipboardArchiveError ? '最近一次归档失败，请检查目录权限和磁盘空间。' : notificationState.clipboardArchiveActive ? '正在监听复制内容，文件会自动保存到下方目录。' : notificationState.bridgeStatus === 'running' ? '正在等待归档监听确认；尚未开始保存。' : '归档组件不可用，请检查安装后重新启用。'}</p>
          {settings.clipboardArchiveEnabled && notificationState.clipboardArchiveError && <p className="fieldError" role="alert">{notificationState.clipboardArchiveError}</p>}
          <button
            className="clipboardArchiveDirectory"
            type="button"
            onClick={() => window.island?.openClipboardArchiveDirectory().catch(() => notify('剪贴板记录目录打开失败'))}
          >
            <FolderOpen size={13} />
            <span><b>打开保存目录</b><small>文档\Windows灵动岛\剪贴板记录</small></span>
          </button>
        </section>
      </div>
    </div>
  )
}

type LauncherManagerProps = {
  state: LauncherState
  onStateChange: (state: LauncherState) => void
  notify: (message: string) => void
}

function LauncherManager({ state, onStateChange, notify }: LauncherManagerProps) {
  const [tab, setTab] = useState<'apps' | 'website' | 'selected' | 'local'>(state.setupCompleted ? 'local' : 'apps')
  const [candidates, setCandidates] = useState<InstalledAppCandidate[]>([])
  const [candidateIds, setCandidateIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [websiteName, setWebsiteName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [draftNames, setDraftNames] = useState<Record<string, string>>({})
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [websiteErrors, setWebsiteErrors] = useState<{ name?: string; url?: string }>({})
  const [removedEntry, setRemovedEntry] = useState<{ entry: LauncherEntryView; index: number } | null>(null)
  const scanning = useRef(false)

  useEffect(() => { if (state.setupCompleted) setTab('local') }, [state.setupCompleted])

  const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败'
  const availableSlots = maxLauncherEntries - state.entries.length
  const visibleCandidates = candidates.filter(({ name }) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  const loadApplications = async (refresh = false) => {
    if (scanning.current) return
    scanning.current = true
    setLoading(true)
    setScanError(null)
    try {
      setCandidates(window.island ? await window.island.discoverInstalledApps(refresh) : previewInstalledApps)
    } catch (error) {
      setScanError(`应用列表读取失败：${errorMessage(error)}`)
    } finally {
      setLoading(false)
      scanning.current = false
    }
  }

  useEffect(() => {
    void loadApplications()
  }, [])

  const addApplications = async () => {
    if (!candidateIds.length) return
    setOperationError(null)
    setBusy(true)
    try {
      if (window.island) {
        onStateChange(await window.island.addInstalledApps(candidateIds))
        void loadApplications()
      } else {
        const additions = candidates
          .filter((candidate) => candidateIds.includes(candidate.id))
          .map(({ name, icon }) => ({ id: crypto.randomUUID(), kind: 'app' as const, name, icon }))
        onStateChange({ ...state, entries: [...state.entries, ...additions].slice(0, maxLauncherEntries) })
      }
      setCandidateIds([])
      notify('应用已加入快捷入口')
    } catch (error) {
      setOperationError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const pickApplication = async () => {
    setOperationError(null)
    setBusy(true)
    try {
      const next = await window.island?.pickLocalApplication()
      if (next) {
        onStateChange(next)
        notify('本地应用已添加')
      }
    } catch (error) {
      setOperationError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const addWebsite = async (event: React.FormEvent) => {
    event.preventDefault()
    const errors: { name?: string; url?: string } = {}
    if (!launcherNameSchema.safeParse(websiteName).success) errors.name = '请输入 1–24 个字符的名称'
    try { normalizeWebsiteUrl(websiteUrl) } catch { errors.url = '请输入有效的 http 或 https 网站地址'
    }
    setWebsiteErrors(errors)
    if (Object.keys(errors).length || busy) return
    setOperationError(null)
    setBusy(true)
    try {
      const next = window.island
        ? await window.island.addWebsite({ name: websiteName, url: websiteUrl })
        : {
            ...state,
            entries: [...state.entries, {
              id: crypto.randomUUID(),
              kind: 'website' as const,
              name: websiteName.trim()
            }].slice(0, maxLauncherEntries)
          }
      onStateChange(next)
      setWebsiteName('')
      setWebsiteUrl('')
      setTab('selected')
      notify('网站快捷入口已添加')
    } catch (error) {
      setOperationError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const removeEntry = async (id: string) => {
    if (busy) return
    setBusy(true)
    setOperationError(null)
    try {
      const next = window.island
        ? await window.island.removeShortcut(id)
        : { ...state, entries: state.entries.filter((entry) => entry.id !== id) }
      onStateChange(next)
      const index = state.entries.findIndex((entry) => entry.id === id)
      setRemovedEntry({ entry: state.entries[index], index })
      setCandidates((current) => current.map((candidate) => candidate.selectedEntryId === id ? { ...candidate, selectedEntryId: undefined } : candidate))
    } catch (error) {
      setOperationError(errorMessage(error))
    } finally { setBusy(false) }
  }

  const undoRemove = async () => {
    if (!removedEntry || busy) return
    setBusy(true)
    setOperationError(null)
    try {
      if (state.entries.length >= maxLauncherEntries) throw new Error('快捷入口已满，请先腾出位置再撤销')
      const entries = [...state.entries]
      entries.splice(Math.min(removedEntry.index, entries.length), 0, removedEntry.entry)
      onStateChange(window.island ? await window.island.undoRemoveShortcut() : { ...state, entries })
      setRemovedEntry(null)
      void loadApplications()
    } catch (error) { setOperationError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const commitName = async (entry: LauncherEntryView) => {
    setOperationError(null)
    const name = (draftNames[entry.id] ?? entry.name).trim()
    if (!name || name === entry.name) {
      setDraftNames((current) => {
        const next = { ...current }
        delete next[entry.id]
        return next
      })
      return
    }
    try {
      const next = window.island
        ? await window.island.renameShortcut(entry.id, name)
        : { ...state, entries: state.entries.map((item) => item.id === entry.id ? { ...item, name } : item) }
      onStateChange(next)
      setDraftNames((current) => {
        const nextDrafts = { ...current }
        delete nextDrafts[entry.id]
        return nextDrafts
      })
    } catch (error) {
      setOperationError(errorMessage(error))
    }
  }

  const saveOrder = async (ids: string[]) => {
    setOperationError(null)
    try {
      const byId = new Map(state.entries.map((entry) => [entry.id, entry]))
      onStateChange(window.island
        ? await window.island.reorderShortcuts(ids)
        : { ...state, entries: ids.map((id) => byId.get(id)!) })
    } catch (error) {
      setOperationError(errorMessage(error))
    }
  }

  const moveEntry = (id: string, offset: number) => {
    const ids = state.entries.map((entry) => entry.id)
    const from = ids.indexOf(id)
    const to = Math.max(0, Math.min(ids.length - 1, from + offset))
    if (from === to) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    void saveOrder(ids)
  }

  const dropEntry = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return
    const ids = state.entries.map((entry) => entry.id)
    const from = ids.indexOf(draggedId)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setDraggedId(null)
    void saveOrder(ids)
  }

  const finish = async () => {
    try {
      if (window.island) onStateChange(await window.island.completeLauncherSetup())
      window.close()
    } catch (error) {
      setOperationError(errorMessage(error))
    }
  }

  return (
    <div className="launcherManager">
      <header className="launcherManagerHeader">
        <div>
          <span className="launcherEyebrow">已固定 {state.entries.length} / {maxLauncherEntries}</span>
          <h1>启动项管理</h1>
          <p>管理固定入口，以及随时可以搜索的本地文件与工具。</p>
        </div>
        <div className="launcherHeaderActions">
          {!state.setupCompleted && <button className="launcherGhostButton" type="button" onClick={() => void finish()}>跳过</button>}
          <button className="launcherDoneButton" type="button" onClick={() => void finish()}><Check size={15} />完成</button>
        </div>
      </header>

      <aside className="launcherManagerNav" aria-label="快捷入口管理分类">
        <div className="launcherCapacity">
          <span>剩余位置</span>
          <strong>{availableSlots}</strong>
          <div><i style={{ width: `${state.entries.length / maxLauncherEntries * 100}%` }} /></div>
        </div>
        <nav>
          <button className={tab === 'local' ? 'active' : ''} type="button" onClick={() => setTab('local')}>
            <FolderOpen size={17} /><span>本地启动<small>文件、脚本和文件夹</small></span><b>{state.localEntries.length}</b>
          </button>
          <button className={tab === 'apps' ? 'active' : ''} type="button" onClick={() => setTab('apps')}>
            <Library size={17} /><span>选择应用<small>扫描本机程序</small></span>
          </button>
          <button className={tab === 'website' ? 'active' : ''} type="button" onClick={() => setTab('website')}>
            <Link2 size={17} /><span>添加网站<small>名称与网址</small></span>
          </button>
          <button className={tab === 'selected' ? 'active' : ''} type="button" onClick={() => setTab('selected')}>
            <GripVertical size={17} /><span>已选择<small>改名与排序</small></span><b>{state.entries.length}</b>
          </button>
        </nav>
        <button className="launcherLocalButton" type="button" disabled={busy || availableSlots === 0} onClick={() => void pickApplication()}>
          <MonitorDown size={16} />选择 .exe / .lnk
        </button>
      </aside>

      <section className="launcherManagerContent">
        {operationError && <div className="inlineError" role="alert"><span>{operationError}</span><button type="button" aria-label="关闭操作错误" onClick={() => setOperationError(null)}><X size={14} /></button></div>}
        {removedEntry && <div className="undoNotice" role="status"><span>已删除“{removedEntry.entry.name}”</span><button type="button" disabled={busy} onClick={() => void undoRemove()}>撤销删除</button></div>}
        {tab === 'local' ? <LocalLaunchManager state={state} onStateChange={onStateChange} notify={notify} /> : tab === 'apps' ? (
          <>
            <div className="launcherContentToolbar">
              <label className="launcherSearch"><Search size={15} /><input aria-label="搜索已安装应用" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索已安装应用" /></label>
              <button type="button" disabled={loading} onClick={() => void loadApplications(true)}><RefreshCw className={loading ? 'spinning' : ''} size={15} />刷新</button>
            </div>
            {scanError && <div className="inlineError" role="alert"><span>{scanError}。可重试或手动选择应用。</span><button type="button" disabled={loading} onClick={() => void loadApplications(true)}>重试</button></div>}
            {loading && candidates.length > 0 && <p className="listStatus" role="status">正在刷新，保留上次扫描结果…</p>}
            <div className="launcherAppList" aria-busy={loading}>
              {loading && !candidates.length ? <div className="launcherEmpty"><RefreshCw className="spinning" size={22} /><p>正在读取 Windows 应用列表…</p></div>
                : visibleCandidates.length ? visibleCandidates.map((candidate) => {
                  const queued = candidateIds.includes(candidate.id)
                  const selected = Boolean(candidate.selectedEntryId)
                  const disabled = !queued && !selected && candidateIds.length >= availableSlots
                  return (
                    <button
                      className={`launcherAppCard ${queued || selected ? 'selected' : ''}`}
                      key={candidate.id}
                      type="button"
                      disabled={selected || disabled}
                      onClick={() => setCandidateIds((current) => queued ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])}
                    >
                      <span className="launcherCandidateIcon">{candidate.icon ? <img src={candidate.icon} alt="" /> : <AppWindow size={19} />}</span>
                      <span>{candidate.name}</span>
                      <i>{selected ? '已添加' : queued ? <Check size={13} /> : <Plus size={13} />}</i>
                    </button>
                  )
                }) : <div className="launcherEmpty"><Search size={22} /><p>{scanError ? '应用列表暂不可用' : search.trim() ? '没有匹配此搜索的应用' : '没有扫描到应用，可手动选择 .exe / .lnk'}</p>{search.trim() && <button type="button" onClick={() => setSearch('')}>清除搜索</button>}</div>}
            </div>
            <footer className="launcherSelectionBar">
              <span>已勾选 <b>{candidateIds.length}</b> 个</span>
              <button type="button" disabled={busy || !candidateIds.length || candidateIds.length > availableSlots} onClick={() => void addApplications()}><Plus size={15} />添加所选</button>
            </footer>
          </>
        ) : tab === 'website' ? (
          <div className="launcherWebsitePane">
            <div className="websiteMark"><Globe2 size={28} /><span>WEB SHORTCUT</span></div>
            <div>
              <h2>添加网站</h2>
              <p>保存后将使用 Windows 默认浏览器打开，并自动尝试获取网站图标。</p>
            </div>
            <form noValidate onSubmit={(event) => void addWebsite(event)}>
              <label><span>显示名称</span><input required maxLength={24} aria-invalid={Boolean(websiteErrors.name)} aria-describedby={websiteErrors.name ? 'website-name-error' : undefined} value={websiteName} onChange={(event) => { setWebsiteName(event.target.value); setWebsiteErrors((current) => ({ ...current, name: undefined })) }} placeholder="例如：团队工作台" /></label>
              {websiteErrors.name && <p id="website-name-error" className="fieldError" role="alert">{websiteErrors.name}</p>}
              <label><span>网站地址</span><input required maxLength={2048} aria-invalid={Boolean(websiteErrors.url)} aria-describedby="website-url-help website-url-error" value={websiteUrl} onChange={(event) => { setWebsiteUrl(event.target.value); setWebsiteErrors((current) => ({ ...current, url: undefined })) }} placeholder="example.com" /></label>
              <p id="website-url-help" className="fieldHelp">省略协议时默认使用 HTTPS。</p>
              <p id="website-url-error" className="fieldError" role={websiteErrors.url ? 'alert' : undefined}>{websiteErrors.url}</p>
              <button type="submit" disabled={busy || availableSlots === 0}><ExternalLink size={16} />添加网站入口</button>
            </form>
            {availableSlots === 0 && <p className="launcherLimitNotice">快捷入口已满，请先在“已选择”中删除一个入口。</p>}
          </div>
        ) : (
          <div className="launcherSelectedPane">
            <header><div><h2>已选择</h2><p>拖拽排序，或使用方向按钮精确移动。</p></div><span>{state.entries.length}/{maxLauncherEntries}</span></header>
            <div className="launcherSelectedList">
              {state.entries.length ? state.entries.map((entry, index) => (
                <div
                  className={`launcherSelectedRow ${draggedId === entry.id ? 'dragging' : ''}`}
                  key={entry.id}
                  draggable
                  onDragStart={() => setDraggedId(entry.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropEntry(entry.id)}
                >
                  <GripVertical className="dragHandle" size={16} aria-hidden />
                  <span className="launcherSelectedIcon"><ShortcutIcon entry={entry} size={18} /></span>
                  <input
                    aria-label={`重命名 ${entry.name}`}
                    maxLength={24}
                    value={draftNames[entry.id] ?? entry.name}
                    onChange={(event) => setDraftNames((current) => ({ ...current, [entry.id]: event.target.value }))}
                    onBlur={() => void commitName(entry)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        setDraftNames((current) => ({ ...current, [entry.id]: entry.name }))
                        event.currentTarget.blur()
                      }
                    }}
                  />
                  <span className="launcherEntryKind">{entry.kind === 'website' ? '网站' : '应用'}</span>
                  <div className="launcherRowActions">
                    <button type="button" disabled={index === 0} onClick={() => moveEntry(entry.id, -1)} aria-label={`前移 ${entry.name}`}><ArrowUp size={14} /></button>
                    <button type="button" disabled={index === state.entries.length - 1} onClick={() => moveEntry(entry.id, 1)} aria-label={`后移 ${entry.name}`}><ArrowDown size={14} /></button>
                    <button className="danger" type="button" disabled={busy} onClick={() => void removeEntry(entry.id)} aria-label={`删除 ${entry.name}`}><Trash2 size={14} /></button>
                  </div>
                </div>
              )) : <div className="launcherEmpty"><GripVertical size={22} /><p>还没有选择快捷入口</p></div>}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function NotificationPanelContent({
  state,
  settings,
  onEnable,
  onDismiss,
  onClear
}: {
  state: NotificationCenterState
  settings: IslandSettings
  onEnable: () => void
  onDismiss: () => void
  onClear: () => void
}) {
  const [sourceId, setSourceId] = useState('all')
  const items = sourceId === 'all' ? state.items : state.items.filter((item) => item.appId === sourceId)
  if (!settings.notificationsEnabled && !settings.notificationOnboardingDismissed) {
    return (
      <div className="notificationOnboarding">
        <span><Bell size={22} /></span>
        <div><b>让通知在顶部轻轻出现</b><p>启用后读取 Windows 通知中心；消息只保存在本次运行内。</p></div>
        <button type="button" onClick={onEnable}>启用</button>
        <button className="quiet" type="button" onClick={onDismiss}>稍后</button>
      </div>
    )
  }

  if (settings.notificationsEnabled && ['denied', 'unavailable', 'error'].includes(state.accessStatus)) {
    return (
      <div className="notificationOnboarding denied">
        <span><BellOff size={22} /></span>
        <div><b>{state.accessStatus === 'denied' ? 'Windows 已拒绝通知访问' : '通知组件暂不可用'}</b><p>{state.accessStatus === 'denied' ? '请在 Windows 隐私设置中重新授权。' : state.accessStatus === 'unavailable' ? '请修复通知组件安装后重试。' : '请重试连接；其他功能仍可使用。'}</p></div>
        <button type="button" onClick={state.accessStatus === 'denied' ? () => void window.island?.openNotificationSettings() : onEnable}>{state.accessStatus === 'denied' ? '权限设置' : '重试连接'}</button>
      </div>
    )
  }

  return (
    <div className="notificationPanelContent">
      <div className="notificationListHeader">
        <span>{items.length} 组通知</span>
        <select aria-label="按通知来源筛选" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="all">全部来源</option>{state.sources.filter((source) => !source.muted).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
        {state.items.length > 0 && <button type="button" title="只清空流屿桌面本次运行中的历史，不删除 Windows 系统通知" aria-label="清空流屿桌面本次运行的通知历史" onClick={onClear}>清空本地</button>}
      </div>
      <div className="notificationList">
        {items.length ? items.map((item) => (
          <button type="button" key={item.id} onClick={() => window.island?.openNotificationSource(item.appId)}>
            <span className="notificationAppIcon"><NotificationIcon item={{ ...item, name: item.appName }} /></span>
            <span className="notificationListCopy">
              <span><b>{item.title || item.appName}</b><small>{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</small></span>
              <em>{settings.showNotificationPreview ? (item.body || '收到一条新通知') : item.appName}</em>
            </span>
            {item.groupCount > 1 && <span className="notificationCount">+{item.groupCount - 1}</span>}
          </button>
        )) : <div className="notificationEmpty"><Bell size={22} /><span>{sourceId !== 'all' ? '该来源暂无通知' : settings.notificationsEnabled ? '新通知会出现在这里' : '通知监听已关闭'}</span>{sourceId !== 'all' && <button type="button" onClick={() => setSourceId('all')}>查看全部来源</button>}</div>}
      </div>
    </div>
  )
}

function App() {
  const [snapshot, setSnapshot] = useState(previewSnapshot)
  const [launcherState, setLauncherState] = useState(previewLauncherState)
  const [notificationState, setNotificationState] = useState(previewNotificationState)
  const [panelView, setPanelView] = useState<'launcher' | 'notifications'>('launcher')
  const [feedback, setFeedback] = useState<Feedback>({ message: '', sequence: 0 })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const closeGuard = useRef<() => boolean>(() => true)
  const settingsRef = useRef(snapshot.settings)
  settingsRef.current = snapshot.settings
  const persistenceRef = useRef<SettingsPersistence | null>(null)
  const previewSettingsRevision = useRef(0)
  if (!persistenceRef.current) persistenceRef.current = new SettingsPersistence(
    snapshot.settings,
    async (patch) => window.island ? window.island.updateSettings(patch) : { settings: applySettingsPatch(settingsRef.current, patch), settingsRevision: ++previewSettingsRevision.current },
    (settings, status) => {
      settingsRef.current = settings
      setSnapshot((current) => ({ ...current, settings }))
      setSaveStatus(status)
    }
  )
  const persistence = persistenceRef.current
  const setCloseGuard = React.useCallback((guard: () => boolean) => { closeGuard.current = guard }, [])
  useBridge(setSnapshot, setFeedback, persistence)
  useLauncherBridge(setLauncherState, setFeedback)
  useNotificationBridge(setNotificationState, setFeedback)

  useEffect(() => window.island?.onPanelView(setPanelView), [])

  useEffect(() => {
    if (requestedSurface === 'panel' && panelView === 'notifications') void window.island?.markNotificationsRead()
  }, [panelView])

  useEffect(() => {
    if (!feedback.message || feedback.kind === 'error') return
    const id = window.setTimeout(() => {
      setFeedback((current) => current.sequence === feedback.sequence ? { ...current, message: '' } : current)
    }, 1200)
    return () => window.clearTimeout(id)
  }, [feedback])

  useEffect(() => window.island?.onPrepareClose(async () => {
    if (!closeGuard.current()) return false
    return persistence.flush()
  }), [persistence])

  const panelState = snapshot.state === 'EXPANDED'
  const surface: RendererSurface = requestedSurface === 'creator' || requestedSurface === 'settings' || requestedSurface === 'launcher'
    ? requestedSurface
    : requestedSurface ?? (panelState ? 'panel' : 'compact')
  const surfaceActive = surface === 'creator' || surface === 'settings' || surface === 'launcher'
    ? true
    : requestedSurface
      ? snapshot.compactMode === 'notification' || isSurfaceActive(surface, snapshot.state)
    : snapshot.state !== 'HIDDEN'
  const palette = palettes[snapshot.settings.theme]
  const date = new Date(snapshot.now)
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  const notify = (message: string) => setFeedback((current) => ({ message, sequence: current.sequence + 1 }))
  const notifyError = (message: string) => setFeedback((current) => ({ message, kind: 'error', sequence: current.sequence + 1 }))
  const queueSettingsSave = (patch: IslandSettingsPatch) => {
    void persistence.enqueue(patch)
  }
  const updateFluidCloud = (patch: Partial<FluidCloudSettings>) => {
    const fluidCloud = { ...settingsRef.current.fluidCloud, ...patch }
    settingsRef.current = { ...settingsRef.current, fluidCloud }
    setSnapshot((current) => ({ ...current, settings: { ...current.settings, fluidCloud } }))
    queueSettingsSave({ fluidCloud: patch })
  }
  const updateGeneralSettings = (patch: Partial<IslandSettings>) => {
    settingsRef.current = { ...settingsRef.current, ...patch }
    setSnapshot((current) => ({ ...current, settings: { ...current.settings, ...patch } }))
    queueSettingsSave(patch)
  }
  const requestNotificationAccess = () => {
    updateGeneralSettings({ notificationsEnabled: true, notificationOnboardingDismissed: true })
    if (window.island) {
      void persistence.flush().then((saved) => {
        if (saved) return window.island!.requestNotificationAccess().then(setNotificationState)
      }).catch(() => notifyError('无法请求 Windows 通知权限'))
    } else {
      setNotificationState((current) => ({ ...current, enabled: true, accessStatus: 'allowed' }))
    }
  }
  const updateCreations = async (fluidCloudCreations: FluidCloudCreation[]) => {
    const saved = await persistence.enqueue({ fluidCloudCreations })
    if (!saved) notifyError('方案目录保存失败，修改已保留，请点击重试保存')
    return saved
  }
  const setExpanded = (expanded: boolean) => {
    if (window.island) window.island.setExpanded(expanded)
    else setSnapshot((current) => ({ ...current, state: expanded ? 'EXPANDED' : 'COMPACT' }))
  }
  return (
    <main
      className={`stage surface-${surface} ${surfaceActive ? 'isActive' : 'isInactive'} compact-mode-${snapshot.compactMode}`}
      style={{
        '--bg': palette[0],
        '--fg': palette[1],
        '--accent': palette[2],
        '--panel': palette[3],
        '--alpha': snapshot.settings.opacity,
        '--cloud-color': snapshot.settings.fluidCloud.color,
        '--cloud-secondary-color': snapshot.settings.fluidCloud.secondaryColor,
        '--cloud-tertiary-color': snapshot.settings.fluidCloud.tertiaryColor,
        '--cloud-speed': snapshot.settings.fluidCloud.speed,
        '--cloud-response': snapshot.settings.fluidCloud.response,
        '--cloud-noise-scale': snapshot.settings.fluidCloud.noiseScale,
        '--cloud-depth': snapshot.settings.fluidCloud.depth,
        '--cloud-curvature': snapshot.settings.fluidCloud.curvature
      } as React.CSSProperties}
    >
      <section className="surfaceFrame">
        {surface === 'creator' ? (
          <CloudStudio
            settings={snapshot.settings}
            onCloudChange={updateFluidCloud}
            onCreationsChange={updateCreations}
            notify={notify}
            setCloseGuard={setCloseGuard}
            saveStatus={saveStatus}
            onRetrySave={() => void persistence.flush()}
          />
        ) : surface === 'settings' ? (
          <GeneralSettings
            settings={snapshot.settings}
            notificationState={notificationState}
            onSettingsChange={updateGeneralSettings}
            onRequestNotificationAccess={requestNotificationAccess}
            notify={notifyError}
          />
        ) : surface === 'launcher' ? (
          <LauncherManager state={launcherState} onStateChange={setLauncherState} notify={notify} />
        ) : surface === 'compact' ? (
          snapshot.compactMode === 'notification' ? (
            <NotificationPreview state={notificationState} settings={snapshot.settings} />
          ) : (
            <button className="compact" type="button" onClick={() => setExpanded(true)} aria-label="展开流屿桌面">
              <CloudBackdrop cloud={snapshot.settings.fluidCloud} palette={palette} active={surfaceActive} />
              <time>{time}</time><span className="pulse" />
              {notificationState.unreadCount > 0 && <span className={`islandUnreadDot ${notificationState.suppression !== 'accepts' ? 'quiet' : ''}`} aria-label={`${notificationState.unreadCount} 条未读通知`} />}
            </button>
          )
        ) : (
          <div className="panel launcherWorkspaceShell">
            <CloudBackdrop cloud={snapshot.settings.fluidCloud} palette={palette} active={surfaceActive} />
            <div className="dashboardPanel workspaceDashboard">
                <div className="panelChrome">
                  <div className="panelTabs" role="tablist" aria-label="灵动中心页面" onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const next = event.key === 'Home' ? 'launcher' : event.key === 'End' ? 'notifications' : panelView === 'launcher' ? 'notifications' : 'launcher'
                    setPanelView(next)
                    document.getElementById(`tab-${next}`)?.focus()
                  }}>
                    <button id="tab-launcher" aria-controls="panel-launcher" tabIndex={panelView === 'launcher' ? 0 : -1} className={panelView === 'launcher' ? 'active' : ''} type="button" role="tab" aria-selected={panelView === 'launcher'} onClick={() => setPanelView('launcher')}><Waves size={14} />启动台</button>
                    <button id="tab-notifications" aria-controls="panel-notifications" tabIndex={panelView === 'notifications' ? 0 : -1} className={panelView === 'notifications' ? 'active' : ''} type="button" role="tab" aria-selected={panelView === 'notifications'} onClick={() => {
                      setPanelView('notifications')
                      void window.island?.markNotificationsRead()
                    }}><Bell size={14} />通知{notificationState.unreadCount > 0 && <i>{Math.min(99, notificationState.unreadCount)}</i>}</button>
                  </div>
                  <span className="panelClock" title={formatDate(date)}><time>{time}</time></span>
                  <div className="panelTools">
                    <button className="roundButton" type="button" onClick={() => setExpanded(false)} aria-label="收起流屿桌面" title="收起为小胶囊"><ChevronUp size={16} /></button>
                  </div>
                </div>

                <div id="panel-launcher" className="launcherWorkspaceTab" hidden={panelView !== 'launcher'} role="tabpanel" aria-labelledby="tab-launcher">
                  <LauncherWorkspace state={launcherState} active={surfaceActive && panelView === 'launcher'} onStateChange={setLauncherState} notify={notify} onManage={() => window.island?.openLauncherManager()} onCreator={() => window.island?.openCreator()} onSettings={() => window.island?.openSettings()} onCollapse={() => setExpanded(false)} />
                </div>
                <div id="panel-notifications" className="notificationTabPanel" hidden={panelView !== 'notifications'} role="tabpanel" aria-labelledby="tab-notifications">
                  <NotificationPanelContent
                    state={notificationState}
                    settings={snapshot.settings}
                    onEnable={requestNotificationAccess}
                    onDismiss={() => updateGeneralSettings({ notificationOnboardingDismissed: true })}
                    onClear={() => {
                      void window.island?.clearNotificationHistory()
                      setNotificationState((current) => ({ ...current, items: [], unreadCount: 0 }))
                    }}
                  />
                </div>
                <footer className="panelFooter" aria-label="流屿桌面工具">
                  <button title="管理快捷入口" type="button" onClick={() => window.island?.openLauncherManager()}><Library size={14} />管理</button>
                  <button title="流云创作器" type="button" onClick={() => window.island?.openCreator()}><Waves size={14} />创作</button>
                  <button title="通用设置" type="button" onClick={() => window.island?.openSettings()}><Settings size={14} />设置</button>
                  <span className="panelCapacity" aria-label={`已添加 ${launcherState.entries.length} 个快捷入口，最多 ${maxLauncherEntries} 个`}>{launcherState.entries.length} / {maxLauncherEntries}</span>
                </footer>
            </div>
          </div>
        )}
        {surface === 'settings' && <div className={`persistenceStatus ${saveStatus}`} role="status" aria-live="polite">
          <span>{!window.island ? '预览模式 · 不写入本地' : saveStatus === 'saving' ? '正在保存设置…' : saveStatus === 'error' ? '保存失败 · 修改已保留' : '设置已保存到本地'}</span>
          {saveStatus === 'error' && <button type="button" onClick={() => void persistence.flush()}>重试保存</button>}
        </div>}
        {feedback.message && <div className={`feedbackToast ${feedback.kind ?? ''}`} role={feedback.kind === 'error' ? 'alert' : 'status'} aria-live={feedback.kind === 'error' ? 'assertive' : 'polite'}><span>{feedback.message}</span>{feedback.kind === 'error' && <button type="button" aria-label="关闭错误提示" onClick={() => setFeedback((current) => ({ ...current, message: '' }))}><X size={14} /></button>}</div>}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
