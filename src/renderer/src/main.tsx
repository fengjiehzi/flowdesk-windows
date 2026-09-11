import React, { Component, useEffect, ErrorInfo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Check,
  ChevronDown,
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
import { defaultSettings, type FluidCloudCreation, type FluidCloudSettings, type IslandSettings } from '../../shared/settings'
import { isSurfaceActive, type IslandSurface } from '../../shared/islandPresentation'
import { maxLauncherEntries, type InstalledAppCandidate, type LauncherEntryView, type LauncherState } from '../../shared/launcher'
import type { NotificationCenterState, NotificationSource, SystemNotificationItem } from '../../shared/notifications'
import {
  triggerPresetCategories,
  triggerPresets,
  triggerStyles,
  type TriggerStyle
} from '../../shared/triggerGesture'
import type { IslandSnapshot } from '../../shared/types'
import { FluxCanvas } from './fluxCanvas'
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
  now: new Date().toISOString()
}

const previewLauncherState: LauncherState = {
  setupCompleted: false,
  entries: window.island ? [] : [
    { id: 'd194efb4-55a3-47dc-a2ef-c472caeb490c', kind: 'app', name: '文件资源管理器' },
    { id: '0130baba-18a9-4ebd-aa3a-3e4f70a0c804', kind: 'app', name: '记事本' },
    { id: '22f374f8-0a46-42e2-97cf-77f9ab2bb88d', kind: 'app', name: 'Visual Studio Code' },
    { id: '951bf1c1-938e-4863-8927-7555e47a80e0', kind: 'website', name: '工作台' }
  ]
}

const previewNotificationState: NotificationCenterState = {
  accessStatus: 'disabled',
  enabled: false,
  suppression: 'accepts',
  unreadCount: 2,
  sources: [{ id: 'preview-feishu', name: '飞书', muted: false }],
  desktopAdapters: [
    { id: 'desktop:feishu', name: '飞书', status: 'waiting' },
    { id: 'desktop:weixin', name: '微信', status: 'app-not-running' }
  ],
  items: [{
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

type Feedback = { message: string; sequence: number }

function useBridge(
  setSnapshot: React.Dispatch<React.SetStateAction<IslandSnapshot>>,
  setFeedback: React.Dispatch<React.SetStateAction<Feedback>>
) {
  useEffect(() => {
    if (!window.island) {
      const id = window.setInterval(() => setSnapshot((current) => ({ ...current, now: new Date().toISOString() })), 1000)
      return () => window.clearInterval(id)
    }
    window.island.getSnapshot().then(setSnapshot).catch(() => {
      setFeedback((current) => ({ message: '无法连接桌面服务', sequence: current.sequence + 1 }))
    })
    return window.island.onSnapshot(setSnapshot)
  }, [setFeedback, setSnapshot])
}

function useLauncherBridge(
  setLauncherState: React.Dispatch<React.SetStateAction<LauncherState>>,
  setFeedback: React.Dispatch<React.SetStateAction<Feedback>>
) {
  useEffect(() => {
    if (!window.island) return
    window.island.getLauncherState().then(setLauncherState).catch(() => {
      setFeedback((current) => ({ message: '无法读取快捷入口', sequence: current.sequence + 1 }))
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
      setFeedback((current) => ({ message: '无法读取系统通知', sequence: current.sequence + 1 }))
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
    <label className="studioField">
      <span>{label}<output>{display ?? value.toFixed(step < 1 ? 2 : 0)}</output></span>
      <span className="studioFieldControls">
        <input
          type="range"
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
    </label>
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
  compact: { label: '紧凑岛', width: 148, height: 40, previewWidth: 296 },
  notification: { label: '通知胶囊', width: 430, height: 68, previewWidth: 430 },
  panel: { label: '面板顶部', width: 640, height: 28, previewWidth: 560 }
} as const
type FluxPreviewSurface = keyof typeof fluxPreviewSurfaces

function CloudStudio({
  settings,
  onCloudChange,
  onCreationsChange,
  notify
}: {
  settings: IslandSettings
  onCloudChange: (patch: Partial<FluidCloudSettings>) => void
  onCreationsChange: (creations: FluidCloudCreation[]) => Promise<boolean>
  notify: (message: string) => void
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
  const [previewSurface, setPreviewSurface] = useState<FluxPreviewSurface>('compact')
  const cloudRef = useRef(cloud)
  const editStart = useRef<FluidCloudSettings | null>(null)
  cloudRef.current = cloud
  const visiblePresets = triggerStyles.filter((style) => triggerPresets[style].category === category)
  const activePreset = triggerPresets[cloud.shape]
  const preview = fluxPreviewSurfaces[previewSurface]
  const activeCreation = creations.find((creation) => creation.id === activeCreationId)
  const dirty = !sameCloud(savedCloud, cloud) || (activeCreation ? activeCreation.name !== creationName.trim() : true)

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
    if (activeCreationId === creation.id) return
    if (
      activeCreationId
      && dirty
      && !window.confirm(`当前方案“${activeCreation?.name ?? creationName}”有未保存修改，放弃修改并载入“${creation.name}”？`)
    ) return
    setCategory(triggerPresets[creation.cloud.shape].category)
    setActiveCreationId(creation.id)
    setCreationName(creation.name)
    setSavedCloud({ ...creation.cloud })
    applyCloud(creation.cloud)
  }

  const startNewCreation = () => {
    setActiveCreationId(null)
    setSavedCloud(null)
    setCreationName(`${triggerPresets[cloudRef.current.shape].name} 自定义`.slice(0, 24))
  }

  const saveCreation = async () => {
    const name = creationName.trim()
    if (!name) return notify('请输入方案名称')
    const createNew = !activeCreationId
    if (createNew && creations.length >= 32) return notify('方案目录最多保存 32 个方案')
    const id = createNew ? crypto.randomUUID() : activeCreationId
    const nextCreation = { id, name, cloud: { ...cloudRef.current } }
    const nextCreations = createNew
      ? [...creations, nextCreation]
      : creations.map((creation) => creation.id === id ? nextCreation : creation)
    setSaving(true)
    const saved = await onCreationsChange(nextCreations)
    setSaving(false)
    if (!saved) return
    setActiveCreationId(id)
    setSavedCloud({ ...cloudRef.current })
    notify(`已保存“${name}”`)
  }

  const duplicateCreation = async (creation: FluidCloudCreation) => {
    if (creations.length >= 32) return notify('方案目录最多保存 32 个方案')
    const name = `${creation.name} 副本`.slice(0, 24)
    if (await onCreationsChange([...creations, { id: crypto.randomUUID(), name, cloud: { ...creation.cloud } }])) {
      notify(`已复制“${creation.name}”`)
    }
  }

  const renameCreation = async (creation: FluidCloudCreation) => {
    const name = window.prompt('输入新的方案名称', creation.name)?.trim()
    if (!name || name.length > 24) return
    if (await onCreationsChange(creations.map((item) => item.id === creation.id ? { ...item, name } : item))) {
      if (activeCreationId === creation.id) setCreationName(name)
      notify(`已重命名为“${name}”`)
    }
  }

  const deleteCreation = async (creation: FluidCloudCreation) => {
    if (!window.confirm(`删除“${creation.name}”？`)) return
    if (await onCreationsChange(creations.filter((item) => item.id !== creation.id))) {
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
        <div>
          <span className="studioEyebrow">DYNAMIC CLOUD LAB / 31 PRESETS</span>
          <h1>流云创作器</h1>
        </div>
        <div className="studioToolbar">
          <div className="studioCurrent"><span style={{ background: `linear-gradient(135deg, ${cloud.color}, ${cloud.secondaryColor}, ${cloud.tertiaryColor})` }} />{activePreset.name}</div>
          <label className="studioName">
            <span className={dirty ? 'dirty' : ''}>{dirty ? '未保存' : '已保存'}</span>
            <input aria-label="方案名称" value={creationName} maxLength={24} onChange={(event) => setCreationName(event.target.value)} />
          </label>
          <div className="studioHistory">
            <button type="button" onClick={undo} disabled={!undoStack.length} aria-label="撤销" title="撤销"><Undo2 size={15} /></button>
            <button type="button" onClick={redo} disabled={!redoStack.length} aria-label="重做" title="重做"><Redo2 size={15} /></button>
          </div>
          <button className="studioSaveButton" type="button" disabled={saving || !dirty} onClick={() => void saveCreation()}><Save size={14} />保存</button>
        </div>
      </header>

      <aside className="studioSidebar" aria-label="预设分类">
        <div className="studioSectionTitle">预设分类</div>
        <nav>
          {triggerPresetCategories.map((item) => {
            const count = triggerStyles.filter((style) => triggerPresets[style].category === item.id).length
            return (
              <button className={category === item.id ? 'active' : ''} key={item.id} type="button" onClick={() => setCategory(item.id)}>
                <span>{item.name}</span><b>{count}</b>
              </button>
            )
          })}
        </nav>
        <div className="studioLibraryTitle">
          <FolderOpen size={14} />方案目录
          <b>{creations.length}/32</b>
          <button type="button" onClick={startNewCreation} title="新建方案"><Plus size={12} />新建</button>
        </div>
        <div className="studioWorks">
          {creations.length === 0 ? <p>新建并保存方案后会出现在这里。</p> : creations.map((creation) => (
            <div className="studioWork" key={creation.id}>
              <button className={activeCreationId === creation.id ? 'active' : ''} type="button" onClick={() => loadCreation(creation)} title={`载入 ${creation.name}`}>
                <span style={{ background: creation.cloud.color }} />{creation.name}
              </button>
              <div>
                <button type="button" onClick={() => renameCreation(creation)} aria-label={`重命名 ${creation.name}`}>Aa</button>
                <button type="button" onClick={() => duplicateCreation(creation)} aria-label={`复制 ${creation.name}`}><Copy size={13} /></button>
                <button type="button" onClick={() => deleteCreation(creation)} aria-label={`删除 ${creation.name}`}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="studioWorkspace">
        <div className="studioPreview" aria-label="流云实时预览">
          <div className="studioGrid" />
          <div className="studioPreviewModes" aria-label="预览比例">
            {(Object.keys(fluxPreviewSurfaces) as FluxPreviewSurface[]).map((surface) => (
              <button className={previewSurface === surface ? 'active' : ''} key={surface} type="button" onClick={() => setPreviewSurface(surface)}>{fluxPreviewSurfaces[surface].label}</button>
            ))}
          </div>
          <div className={`studioPreviewArt preview-${previewSurface}`} style={{ width: `min(92%, ${preview.previewWidth}px)`, aspectRatio: `${preview.width} / ${preview.height}` }}>
            <FluxCanvas cloud={cloud} {...fluxColors} />
          </div>
          <div className="studioPreviewMeta"><span>实时 WebGL</span><b>{preview.width} × {preview.height}</b></div>
        </div>
        <div className="presetHeader"><h2>{triggerPresetCategories.find((item) => item.id === category)?.name}</h2><span>{visiblePresets.length} 组三色配色</span></div>
        <div className="presetGrid">
          {/* ponytail: categories currently cap at 9 thumbnail contexts; use one shared canvas with Scissor Test if that ceiling grows. */}
          {visiblePresets.map((style) => {
            const presetCloud = cloudFromPreset(style)
            return (
              <button className={`presetCard ${cloud.shape === style ? 'active' : ''}`} key={style} type="button" onClick={() => selectPreset(style)}>
                <span className="presetArt"><FluxCanvas cloud={presetCloud} active={false} animated={false} interactive={false} {...fluxColors} /></span>
                <span className="presetName">{triggerPresets[style].name}</span>
                <span className="presetSize">FLUX</span>
              </button>
            )
          })}
        </div>
      </section>

      <aside className="studioInspector">
        <div className="inspectorHeader"><span>参数检查器</span><button type="button" onClick={() => selectPreset(cloud.shape)}><RotateCcw size={14} />恢复默认</button></div>
        <div className="studioColorFields">
          {([
            ['主色', 'color'],
            ['辅色', 'secondaryColor'],
            ['点缀色', 'tertiaryColor']
          ] as const).map(([label, key]) => (
            <label className="studioColorField" key={key}>
              <span>{label}</span>
              <input type="color" value={cloud[key]} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => applyCloud({ [key]: event.target.value }, false)} />
              <output>{cloud[key].toUpperCase()}</output>
            </label>
          ))}
        </div>
        <div className="inspectorGroup"><h3>FLUX 材质<button type="button" onClick={() => applyCloud(cloudFromPreset(cloud.shape))}>重置</button></h3>
          <RangeField label="流速" value={cloud.speed} min={.25} max={2} step={.05} display={`${cloud.speed.toFixed(2)}×`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(speed) => applyCloud({ speed }, false)} />
          <RangeField label="噪声尺度" value={cloud.noiseScale} min={.5} max={3} step={.05} display={cloud.noiseScale.toFixed(2)} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(noiseScale) => applyCloud({ noiseScale }, false)} />
          <RangeField label="Warp 强度" value={cloud.curvature} min={0} max={1} step={.05} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(curvature) => applyCloud({ curvature }, false)} />
          <RangeField label="色彩密度" value={cloud.depth} min={.5} max={1.5} step={.05} display={`${Math.round(cloud.depth * 100)}%`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(depth) => applyCloud({ depth }, false)} />
          <RangeField label="交互响应" value={cloud.response} min={.2} max={1.5} step={.05} display={`${cloud.response.toFixed(2)}×`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(response) => applyCloud({ response }, false)} />
        </div>
      </aside>
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
  return (
    <div className="generalSettingsShell">
      <header className="generalSettingsHeader">
        <span><Settings size={22} /></span>
        <div><small>WINDOWS DYNAMIC ISLAND</small><h1>通用设置</h1><p>管理灵动岛行为、系统通知和剪贴板归档。</p></div>
      </header>
      <div className="generalSettingsBody">
        <section className="settingsCard inspectorGroup"><h3>灵动岛行为</h3>
          <div className="shortcutSummary"><span><b>全局快捷键</b><small>在任意程序中显示紧凑岛</small></span><kbd>Ctrl + Alt + Space</kbd></div>
          <RangeField label="智能隐藏延迟" value={settings.hideDelayMs} min={300} max={3000} step={100} display={`${settings.hideDelayMs}ms`} onChange={(hideDelayMs) => onSettingsChange({ hideDelayMs })} />
        </section>

        <section className="settingsCard inspectorGroup notificationSettings"><h3>系统通知</h3>
          <label className="notificationToggle">
            <span><b>监听通知中心</b><small>{notificationState.accessStatus === 'allowed' ? '已授权' : notificationState.accessStatus === 'denied' ? '已拒绝' : '未启用'}</small></span>
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
            <span><b>微信/飞书桌面弹窗</b><small>仅读取新弹窗，内容只驻留内存</small></span>
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
        </section>

        <section className="settingsCard inspectorGroup clipboardArchiveSettings"><h3>剪贴板归档</h3>
          <label className="notificationToggle">
            <span><b>自动保存复制内容</b><small>记录所有剪贴板变化，可能包含敏感信息</small></span>
            <input type="checkbox" checked={settings.clipboardArchiveEnabled} onChange={(event) => onSettingsChange({ clipboardArchiveEnabled: event.target.checked })} />
          </label>
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
  const [tab, setTab] = useState<'apps' | 'website' | 'selected'>('apps')
  const [candidates, setCandidates] = useState<InstalledAppCandidate[]>([])
  const [candidateIds, setCandidateIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [websiteName, setWebsiteName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [draftNames, setDraftNames] = useState<Record<string, string>>({})
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败'
  const availableSlots = maxLauncherEntries - state.entries.length
  const visibleCandidates = candidates.filter(({ name }) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  const loadApplications = async (refresh = false) => {
    setLoading(true)
    try {
      setCandidates(window.island ? await window.island.discoverInstalledApps(refresh) : previewInstalledApps)
    } catch (error) {
      notify(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadApplications()
  }, [])

  const addApplications = async () => {
    if (!candidateIds.length) return
    setBusy(true)
    try {
      if (window.island) {
        onStateChange(await window.island.addInstalledApps(candidateIds))
        setCandidates(await window.island.discoverInstalledApps())
      } else {
        const additions = candidates
          .filter((candidate) => candidateIds.includes(candidate.id))
          .map(({ name, icon }) => ({ id: crypto.randomUUID(), kind: 'app' as const, name, icon }))
        onStateChange({ ...state, entries: [...state.entries, ...additions].slice(0, maxLauncherEntries) })
      }
      setCandidateIds([])
      notify('应用已加入快捷入口')
    } catch (error) {
      notify(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const pickApplication = async () => {
    setBusy(true)
    try {
      const next = await window.island?.pickLocalApplication()
      if (next) {
        onStateChange(next)
        notify('本地应用已添加')
      }
    } catch (error) {
      notify(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const addWebsite = async (event: React.FormEvent) => {
    event.preventDefault()
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
      notify(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const removeEntry = async (id: string) => {
    try {
      const next = window.island
        ? await window.island.removeShortcut(id)
        : { ...state, entries: state.entries.filter((entry) => entry.id !== id) }
      onStateChange(next)
      setCandidates((current) => current.map((candidate) => candidate.selectedEntryId === id ? { ...candidate, selectedEntryId: undefined } : candidate))
    } catch (error) {
      notify(errorMessage(error))
    }
  }

  const commitName = async (entry: LauncherEntryView) => {
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
      notify(errorMessage(error))
    }
  }

  const saveOrder = async (ids: string[]) => {
    try {
      const byId = new Map(state.entries.map((entry) => [entry.id, entry]))
      onStateChange(window.island
        ? await window.island.reorderShortcuts(ids)
        : { ...state, entries: ids.map((id) => byId.get(id)!) })
    } catch (error) {
      notify(errorMessage(error))
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
      notify(errorMessage(error))
    }
  }

  return (
    <div className="launcherManager">
      <header className="launcherManagerHeader">
        <div>
          <span className="launcherEyebrow">QUICK ACCESS / {state.entries.length} OF {maxLauncherEntries}</span>
          <h1>快捷入口管理器</h1>
          <p>把常用应用和网站留在伸手可及的地方。</p>
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
        {tab === 'apps' ? (
          <>
            <div className="launcherContentToolbar">
              <label className="launcherSearch"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索已安装应用" /></label>
              <button type="button" disabled={loading} onClick={() => void loadApplications(true)}><RefreshCw className={loading ? 'spinning' : ''} size={15} />刷新</button>
            </div>
            <div className="launcherAppList" aria-busy={loading}>
              {loading ? <div className="launcherEmpty"><RefreshCw className="spinning" size={22} /><p>正在读取 Windows 应用列表…</p></div>
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
                }) : <div className="launcherEmpty"><Search size={22} /><p>没有找到匹配的应用</p></div>}
            </div>
            <footer className="launcherSelectionBar">
              <span>已勾选 <b>{candidateIds.length}</b> 个</span>
              <button type="button" disabled={busy || !candidateIds.length} onClick={() => void addApplications()}><Plus size={15} />添加所选</button>
            </footer>
          </>
        ) : tab === 'website' ? (
          <div className="launcherWebsitePane">
            <div className="websiteMark"><Globe2 size={28} /><span>WEB SHORTCUT</span></div>
            <div>
              <h2>添加网站</h2>
              <p>保存后将使用 Windows 默认浏览器打开，并自动尝试获取网站图标。</p>
            </div>
            <form onSubmit={(event) => void addWebsite(event)}>
              <label><span>显示名称</span><input required maxLength={24} value={websiteName} onChange={(event) => setWebsiteName(event.target.value)} placeholder="例如：团队工作台" /></label>
              <label><span>网站地址</span><input required maxLength={2048} value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="example.com" /></label>
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
                    <button className="danger" type="button" onClick={() => void removeEntry(entry.id)} aria-label={`删除 ${entry.name}`}><Trash2 size={14} /></button>
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
        <div><b>{state.accessStatus === 'denied' ? 'Windows 已拒绝通知访问' : '通知桥接暂不可用'}</b><p>可在系统隐私设置中重新授权，不会影响其他灵动岛功能。</p></div>
        <button type="button" onClick={() => window.island?.openNotificationSettings()}>打开设置</button>
      </div>
    )
  }

  return (
    <div className="notificationPanelContent">
      <div className="notificationListHeader">
        <span>{state.items.length ? `${state.items.length} 条通知` : '通知中心'}</span>
        {state.items.length > 0 && <button type="button" onClick={onClear}>清空本地</button>}
      </div>
      <div className="notificationList">
        {state.items.length ? state.items.map((item) => (
          <button type="button" key={item.id} onClick={() => window.island?.openNotificationSource(item.appId)}>
            <span className="notificationAppIcon"><NotificationIcon item={{ ...item, name: item.appName }} /></span>
            <span className="notificationListCopy">
              <span><b>{item.title || item.appName}</b><small>{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</small></span>
              <em>{settings.showNotificationPreview ? (item.body || '收到一条新通知') : item.appName}</em>
            </span>
            {item.groupCount > 1 && <span className="notificationCount">+{item.groupCount - 1}</span>}
          </button>
        )) : <div className="notificationEmpty"><Bell size={22} /><span>新通知会出现在这里</span></div>}
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
  const settingsSaveTimer = useRef<number | null>(null)
  const pendingSettingsPatch = useRef<Partial<IslandSettings>>({})
  const settingsRef = useRef(snapshot.settings)
  settingsRef.current = snapshot.settings
  useBridge(setSnapshot, setFeedback)
  useLauncherBridge(setLauncherState, setFeedback)
  useNotificationBridge(setNotificationState, setFeedback)

  useEffect(() => window.island?.onPanelView(setPanelView), [])

  useEffect(() => {
    if (requestedSurface === 'panel' && panelView === 'notifications') void window.island?.markNotificationsRead()
  }, [panelView])

  useEffect(() => {
    if (!feedback.message) return
    const id = window.setTimeout(() => {
      setFeedback((current) => current.sequence === feedback.sequence ? { ...current, message: '' } : current)
    }, 1200)
    return () => window.clearTimeout(id)
  }, [feedback])

  useEffect(() => () => {
    if (settingsSaveTimer.current) window.clearTimeout(settingsSaveTimer.current)
    if (window.island && Object.keys(pendingSettingsPatch.current).length) {
      void window.island.updateSettings(pendingSettingsPatch.current)
    }
  }, [])

  const panelState = ['EXPANDED', 'SETTINGS_OPEN'].includes(snapshot.state)
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
  const launchShortcut = async (entry: LauncherEntryView) => {
    try {
      if (window.island) await window.island.launchShortcut(entry.id)
      else notify(`正在打开 ${entry.name}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '快捷入口启动失败')
    }
  }
  const queueSettingsSave = (patch: Partial<IslandSettings>) => {
    if (!window.island) return
    pendingSettingsPatch.current = {
      ...pendingSettingsPatch.current,
      ...patch,
      fluidCloud: patch.fluidCloud ?? pendingSettingsPatch.current.fluidCloud
    }
    if (settingsSaveTimer.current) window.clearTimeout(settingsSaveTimer.current)
    settingsSaveTimer.current = window.setTimeout(() => {
      const nextPatch = pendingSettingsPatch.current
      pendingSettingsPatch.current = {}
      window.island?.updateSettings(nextPatch).catch(() => notify('流云设置保存失败'))
      settingsSaveTimer.current = null
    }, 60)
  }
  const updateFluidCloud = (patch: Partial<FluidCloudSettings>) => {
    const fluidCloud = { ...settingsRef.current.fluidCloud, ...patch }
    settingsRef.current = { ...settingsRef.current, fluidCloud }
    setSnapshot((current) => ({ ...current, settings: { ...current.settings, fluidCloud } }))
    queueSettingsSave({ fluidCloud })
  }
  const updateGeneralSettings = (patch: Partial<IslandSettings>) => {
    settingsRef.current = { ...settingsRef.current, ...patch }
    setSnapshot((current) => ({ ...current, settings: { ...current.settings, ...patch } }))
    queueSettingsSave(patch)
  }
  const requestNotificationAccess = () => {
    updateGeneralSettings({ notificationsEnabled: true, notificationOnboardingDismissed: true })
    if (window.island) {
      window.island.requestNotificationAccess().then(setNotificationState).catch(() => notify('无法请求 Windows 通知权限'))
    } else {
      setNotificationState((current) => ({ ...current, enabled: true, accessStatus: 'allowed' }))
    }
  }
  const updateCreations = async (fluidCloudCreations: FluidCloudCreation[]) => {
    const previous = settingsRef.current.fluidCloudCreations
    settingsRef.current = { ...settingsRef.current, fluidCloudCreations }
    setSnapshot((current) => ({ ...current, settings: { ...current.settings, fluidCloudCreations } }))
    if (!window.island) return true
    try {
      await window.island.updateSettings({ fluidCloudCreations })
      return true
    } catch {
      settingsRef.current = { ...settingsRef.current, fluidCloudCreations: previous }
      setSnapshot((current) => ({ ...current, settings: { ...current.settings, fluidCloudCreations: previous } }))
      notify('方案目录保存失败')
      return false
    }
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
          />
        ) : surface === 'settings' ? (
          <GeneralSettings
            settings={snapshot.settings}
            notificationState={notificationState}
            onSettingsChange={updateGeneralSettings}
            onRequestNotificationAccess={requestNotificationAccess}
            notify={notify}
          />
        ) : surface === 'launcher' ? (
          <LauncherManager state={launcherState} onStateChange={setLauncherState} notify={notify} />
        ) : surface === 'compact' ? (
          snapshot.compactMode === 'notification' ? (
            <NotificationPreview state={notificationState} settings={snapshot.settings} />
          ) : (
            <button className="compact" type="button" onClick={() => setExpanded(true)} aria-label="展开灵动岛">
              <CloudBackdrop cloud={snapshot.settings.fluidCloud} palette={palette} active={surfaceActive} />
              <time>{time}</time><span className="pulse" />
              {notificationState.unreadCount > 0 && <span className={`islandUnreadDot ${notificationState.suppression !== 'accepts' ? 'quiet' : ''}`} aria-label={`${notificationState.unreadCount} 条未读通知`} />}
            </button>
          )
        ) : (
          <div className="panel">
            <div className="dashboardPanel">
                <div className="panelChrome">
                  <CloudBackdrop cloud={snapshot.settings.fluidCloud} palette={palette} active={surfaceActive} />
                  <div className="panelTabs" role="tablist" aria-label="灵动中心页面">
                    <button className={panelView === 'launcher' ? 'active' : ''} type="button" role="tab" aria-selected={panelView === 'launcher'} onClick={() => setPanelView('launcher')}><Waves size={14} />快捷入口</button>
                    <button className={panelView === 'notifications' ? 'active' : ''} type="button" role="tab" aria-selected={panelView === 'notifications'} onClick={() => {
                      setPanelView('notifications')
                      void window.island?.markNotificationsRead()
                    }}><Bell size={14} />通知{notificationState.unreadCount > 0 && <i>{Math.min(99, notificationState.unreadCount)}</i>}</button>
                  </div>
                  <span className="panelClock"><time>{time}</time><small>{formatDate(date)}</small></span>
                  <div className="panelTools">
                    <button className="roundButton" type="button" onClick={() => setExpanded(false)} aria-label="收起" title="收起"><ChevronDown size={18} /></button>
                  </div>
                </div>

                {panelView === 'launcher' ? <div className="launcherGrid" aria-label="快捷入口">
                  {launcherState.entries.map((entry) => (
                    <button className="launcherTile" title={entry.name} key={entry.id} type="button" onClick={() => void launchShortcut(entry)}>
                      <span><ShortcutIcon entry={entry} /></span>
                      <b>{entry.name}</b>
                    </button>
                  ))}
                  <button className="launcherTile fixed" title="管理快捷入口" type="button" onClick={() => window.island?.openLauncherManager()}>
                    <span><Settings size={22} /></span>
                    <b>管理</b>
                  </button>
                  <button className="launcherTile fixed" title="流云创作器" type="button" onClick={() => window.island?.openCreator()}>
                    <span><Waves size={22} /></span>
                    <b>创作</b>
                  </button>
                </div> : (
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
                )}
            </div>
          </div>
        )}
        {feedback.message && <p className="feedbackToast" role="status" aria-live="polite">{feedback.message}</p>}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
