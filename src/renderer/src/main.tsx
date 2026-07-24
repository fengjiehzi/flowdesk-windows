import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
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
import {
  classicTriggerStyles,
  resolveTriggerGestureAxis,
  shouldRevealFromTrigger,
  triggerPresetCategories,
  triggerPresets,
  triggerStyles,
  type TriggerGestureAxis,
  type TriggerStyle
} from '../../shared/triggerGesture'
import type { IslandSnapshot } from '../../shared/types'
import { TriggerCanvas } from './triggerCanvas'
import './styles.css'

const surfaceParameter = new URLSearchParams(window.location.search).get('surface')
type RendererSurface = IslandSurface | 'creator' | 'launcher'
const requestedSurface: RendererSurface | null = surfaceParameter === 'trigger' || surfaceParameter === 'compact' || surfaceParameter === 'panel' || surfaceParameter === 'creator' || surfaceParameter === 'launcher'
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

const previewSnapshot: IslandSnapshot = {
  state: 'COMPACT',
  settings: defaultSettings,
  now: new Date().toISOString()
}

const previewLauncherState: LauncherState = {
  setupCompleted: false,
  entries: surfaceParameter === null ? [
    { id: 'd194efb4-55a3-47dc-a2ef-c472caeb490c', kind: 'app', name: '文件资源管理器' },
    { id: '0130baba-18a9-4ebd-aa3a-3e4f70a0c804', kind: 'app', name: '记事本' },
    { id: '22f374f8-0a46-42e2-97cf-77f9ab2bb88d', kind: 'app', name: 'Visual Studio Code' },
    { id: '951bf1c1-938e-4863-8927-7555e47a80e0', kind: 'website', name: '工作台' }
  ] : []
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

function formatDate(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 星期${'日一二三四五六'[date.getDay()]}`
}

function ShortcutIcon({ entry, size = 22 }: { entry: Pick<LauncherEntryView, 'kind' | 'icon'>; size?: number }) {
  if (entry.icon) return <img className="shortcutImage" src={entry.icon} alt="" />
  return entry.kind === 'website' ? <Globe2 size={size} /> : <AppWindow size={size} />
}

function CloudEffects({ cloud }: { cloud: FluidCloudSettings }) {
  return (
    <span className="cloudEffects" aria-hidden>
      {Array.from({ length: cloud.strands }, (_, index) => (
        <span
          className="cloudStrand"
          key={`strand-${index}`}
          style={{ '--cloud-index': index, '--cloud-count': cloud.strands } as React.CSSProperties}
        />
      ))}
      {Array.from({ length: cloud.particles }, (_, index) => (
        <span
          className="cloudParticle"
          key={`particle-${index}`}
          style={{
            '--cloud-index': index,
            left: `${10 + (index * 37) % 80}%`,
            top: `${3 + (index * 11) % 18}px`
          } as React.CSSProperties}
        />
      ))}
    </span>
  )
}

function TriggerArtwork({
  style,
  cloud,
  active = true,
  pointerResponsive = true
}: {
  style: TriggerStyle
  cloud: FluidCloudSettings
  active?: boolean
  pointerResponsive?: boolean
}) {
  if (!classicTriggerStyles.includes(style)) {
    return (
      <span className="triggerSkin canvasTriggerSkin" aria-hidden>
        <TriggerCanvas cloud={cloud} active={active} pointerResponsive={pointerResponsive} />
      </span>
    )
  }

  if (style === 'liquid-ridge') {
    return (
      <span className="triggerSkin liquidRidge" aria-hidden>
        <svg viewBox="0 0 212 30" preserveAspectRatio="none">
          <path className="liquidBody" d="M0 0H212V5C176 5 158 6 142 11C126 16 122 27 106 28C90 27 86 16 70 11C54 6 36 5 0 5Z" />
          <path className="liquidEdge" d="M0 5C36 5 54 6 70 11C86 16 90 27 106 28C122 27 126 16 142 11C158 6 176 5 212 5" />
          <path className="liquidCurrent liquidCurrentRear" d="M40 5C70 5 82 10 94 17C101 21 105 22 112 20C124 17 132 9 166 5" />
          <path className="liquidCurrent liquidCurrentFront" d="M58 6C79 8 88 17 99 21C107 24 116 21 124 16C133 10 145 6 158 6" />
        </svg>
        <span className="liquidSeam" />
        <CloudEffects cloud={cloud} />
      </span>
    )
  }

  if (style === 'magnetic-rail') {
    return (
      <span className="triggerSkin magneticRail" aria-hidden>
        <span className="magneticTrack magneticTrackLeft"><span /></span>
        <span className="magneticCore"><span className="magneticEnergy" /></span>
        <span className="magneticTrack magneticTrackRight"><span /></span>
        <span className="magneticTongue" />
        <CloudEffects cloud={cloud} />
      </span>
    )
  }

  return (
    <span className="triggerSkin edgeDock" aria-hidden>
      <span className="dockRail" />
      <span className="dockPulse dockPulseLeft" />
      <span className="dockPulse dockPulseRight" />
      <span className="dockCore"><span /></span>
      <CloudEffects cloud={cloud} />
    </span>
  )
}

function cloudFromPreset(style: TriggerStyle): FluidCloudSettings {
  const preset = triggerPresets[style]
  return {
    shape: style,
    color: preset.color,
    strands: preset.strands,
    particles: preset.particles,
    speed: preset.speed,
    response: preset.response,
    widthScale: 1,
    heightScale: 1,
    depth: 1,
    curvature: .55,
    symmetry: 1
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

function CloudStudio({
  settings,
  onCloudChange,
  onSettingsChange,
  onCreationsChange,
  notify
}: {
  settings: IslandSettings
  onCloudChange: (patch: Partial<FluidCloudSettings>) => void
  onSettingsChange: (patch: Partial<IslandSettings>) => void
  onCreationsChange: (creations: FluidCloudCreation[]) => Promise<boolean>
  notify: (message: string) => void
}) {
  const { fluidCloud: cloud, fluidCloudCreations: creations } = settings
  const [category, setCategory] = useState(triggerPresets[cloud.shape].category)
  const [creationName, setCreationName] = useState(`${triggerPresets[cloud.shape].name} 自定义`.slice(0, 24))
  const [activeCreationId, setActiveCreationId] = useState<string | null>(null)
  const [savedCloud, setSavedCloud] = useState<FluidCloudSettings | null>(null)
  const [undoStack, setUndoStack] = useState<FluidCloudSettings[]>([])
  const [redoStack, setRedoStack] = useState<FluidCloudSettings[]>([])
  const [saving, setSaving] = useState(false)
  const cloudRef = useRef(cloud)
  const editStart = useRef<FluidCloudSettings | null>(null)
  cloudRef.current = cloud
  const visiblePresets = triggerStyles.filter((style) => triggerPresets[style].category === category)
  const activePreset = triggerPresets[cloud.shape]
  const artWidth = Math.round(activePreset.width * cloud.widthScale)
  const artHeight = Math.round(activePreset.height * cloud.heightScale)
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
    setActiveCreationId(null)
    setSavedCloud(null)
    setCreationName(`${triggerPresets[style].name} 自定义`.slice(0, 24))
    applyCloud(cloudFromPreset(style))
  }

  const loadCreation = (creation: FluidCloudCreation) => {
    setCategory(triggerPresets[creation.cloud.shape].category)
    setActiveCreationId(creation.id)
    setCreationName(creation.name)
    setSavedCloud({ ...creation.cloud })
    applyCloud(creation.cloud)
  }

  const saveCreation = async (saveAs = false) => {
    const name = creationName.trim()
    if (!name) return notify('请输入作品名称')
    const createNew = saveAs || !activeCreationId
    if (createNew && creations.length >= 32) return notify('作品库最多保存 32 个作品')
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
    if (creations.length >= 32) return notify('作品库最多保存 32 个作品')
    const name = `${creation.name} 副本`.slice(0, 24)
    if (await onCreationsChange([...creations, { id: crypto.randomUUID(), name, cloud: { ...creation.cloud } }])) {
      notify(`已复制“${creation.name}”`)
    }
  }

  const renameCreation = async (creation: FluidCloudCreation) => {
    const name = window.prompt('输入新的作品名称', creation.name)?.trim()
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
          <div className="studioCurrent"><span style={{ background: cloud.color }} />{activePreset.name}</div>
          <label className="studioName">
            <span className={dirty ? 'dirty' : ''}>{dirty ? '未保存' : '已保存'}</span>
            <input aria-label="作品名称" value={creationName} maxLength={24} onChange={(event) => setCreationName(event.target.value)} />
          </label>
          <div className="studioHistory">
            <button type="button" onClick={undo} disabled={!undoStack.length} aria-label="撤销" title="撤销"><Undo2 size={15} /></button>
            <button type="button" onClick={redo} disabled={!redoStack.length} aria-label="重做" title="重做"><Redo2 size={15} /></button>
          </div>
          <button className="studioSaveButton" type="button" disabled={saving || !dirty} onClick={() => void saveCreation(false)}><Save size={14} />保存</button>
          <button className="studioSaveAsButton" type="button" disabled={saving} onClick={() => void saveCreation(true)}>另存为</button>
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
        <div className="studioLibraryTitle"><FolderOpen size={14} />我的作品 <b>{creations.length}/32</b></div>
        <div className="studioWorks">
          {creations.length === 0 ? <p>保存当前设计后会出现在这里。</p> : creations.map((creation) => (
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
          <div className="studioPreviewArt" style={{ width: `min(92%, ${artWidth}px)`, height: artHeight }}>
            <TriggerArtwork style={cloud.shape} cloud={cloud} pointerResponsive={false} />
          </div>
          <div className="studioPreviewMeta"><span>实时画布</span><b>{artWidth} × {artHeight}</b></div>
        </div>
        <div className="presetHeader"><h2>{triggerPresetCategories.find((item) => item.id === category)?.name}</h2><span>{visiblePresets.length} 款唯一动效</span></div>
        <div className="presetGrid">
          {visiblePresets.map((style) => {
            const presetCloud = cloudFromPreset(style)
            return (
              <button className={`presetCard ${cloud.shape === style ? 'active' : ''}`} key={style} type="button" onClick={() => selectPreset(style)}>
                <span className="presetArt"><TriggerArtwork style={style} cloud={presetCloud} active={false} /></span>
                <span className="presetName">{triggerPresets[style].name}</span>
                <span className="presetSize">{triggerPresets[style].width} × {triggerPresets[style].height}</span>
              </button>
            )
          })}
        </div>
      </section>

      <aside className="studioInspector">
        <div className="inspectorHeader"><span>参数检查器</span><button type="button" onClick={() => selectPreset(cloud.shape)}><RotateCcw size={14} />恢复默认</button></div>
        <div className="studioColorField">
          <span>主色</span>
          <input type="color" value={cloud.color} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => applyCloud({ color: event.target.value }, false)} />
          <output>{cloud.color.toUpperCase()}</output>
        </div>
        <div className="inspectorGroup"><h3>几何<button type="button" onClick={() => applyCloud({ widthScale: 1, heightScale: 1, depth: 1, curvature: .55, symmetry: 1 })}>重置</button></h3>
          <RangeField label="宽度" value={artWidth} min={Math.round(activePreset.width * .7)} max={Math.round(activePreset.width * 1.3)} step={1} display={`${artWidth}px`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(width) => applyCloud({ widthScale: Math.max(.7, Math.min(1.3, width / activePreset.width)) }, false)} />
          <RangeField label="视觉高度" value={artHeight} min={Math.round(activePreset.height * .6)} max={Math.round(activePreset.height * 1.6)} step={1} display={`${artHeight}px`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(height) => applyCloud({ heightScale: Math.max(.6, Math.min(1.6, height / activePreset.height)) }, false)} />
          <RangeField label="深度" value={cloud.depth} min={.5} max={1.5} step={.05} display={`${Math.round(cloud.depth * 100)}%`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(depth) => applyCloud({ depth }, false)} />
          <RangeField label="曲率" value={cloud.curvature} min={0} max={1} step={.05} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(curvature) => applyCloud({ curvature }, false)} />
          <RangeField label="对称" value={cloud.symmetry} min={0} max={1} step={.05} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(symmetry) => applyCloud({ symmetry }, false)} />
        </div>
        <div className="inspectorGroup"><h3>动态<button type="button" onClick={() => applyCloud({ strands: activePreset.strands, particles: activePreset.particles, speed: activePreset.speed, response: activePreset.response })}>重置</button></h3>
          <RangeField label="光丝数量" value={cloud.strands} min={1} max={8} step={1} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(strands) => applyCloud({ strands }, false)} />
          <RangeField label="粒子数量" value={cloud.particles} min={0} max={16} step={1} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(particles) => applyCloud({ particles }, false)} />
          <RangeField label="速度" value={cloud.speed} min={.25} max={2} step={.05} display={`${cloud.speed.toFixed(2)}×`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(speed) => applyCloud({ speed }, false)} />
          <RangeField label="响应" value={cloud.response} min={.2} max={1.5} step={.05} display={`${cloud.response.toFixed(2)}×`} onEditStart={beginEdit} onEditEnd={endEdit} onChange={(response) => applyCloud({ response }, false)} />
        </div>
        <div className="inspectorGroup"><h3>交互</h3>
          <RangeField label="顶部触发宽度" value={settings.triggerWidth} min={120} max={800} step={10} display={`${settings.triggerWidth}px`} onChange={(triggerWidth) => onSettingsChange({ triggerWidth })} />
          <RangeField label="顶部触发高度" value={settings.triggerHeight} min={2} max={20} step={1} display={`${settings.triggerHeight}px`} onChange={(triggerHeight) => onSettingsChange({ triggerHeight })} />
          <RangeField label="智能隐藏延迟" value={settings.hideDelayMs} min={300} max={3000} step={100} display={`${settings.hideDelayMs}ms`} onChange={(hideDelayMs) => onSettingsChange({ hideDelayMs })} />
        </div>
      </aside>
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

function App() {
  const [snapshot, setSnapshot] = useState(previewSnapshot)
  const [launcherState, setLauncherState] = useState(previewLauncherState)
  const [feedback, setFeedback] = useState<Feedback>({ message: '', sequence: 0 })
  const [pullDistance, setPullDistance] = useState(0)
  const [gestureActive, setGestureActive] = useState(false)
  const [gestureMode, setGestureMode] = useState<TriggerGestureAxis | null>(null)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const gestureAxis = useRef<TriggerGestureAxis | null>(null)
  const pullTravel = useRef(0)
  const settingsSaveTimer = useRef<number | null>(null)
  const pendingSettingsPatch = useRef<Partial<IslandSettings>>({})
  const settingsRef = useRef(snapshot.settings)
  settingsRef.current = snapshot.settings
  useBridge(setSnapshot, setFeedback)
  useLauncherBridge(setLauncherState, setFeedback)

  useEffect(() => {
    if (requestedSurface !== 'trigger') return
    return window.island?.onTriggerVisualLayout((layout) => {
      if (!pointerStart.current) setPullDistance(layout.pullDistance)
    })
  }, [])

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
  const triggerVisible = snapshot.state === 'TRIGGER_VISIBLE'
  const surface: RendererSurface = requestedSurface === 'creator' || requestedSurface === 'launcher'
    ? requestedSurface
    : requestedSurface ?? (triggerVisible ? 'trigger' : panelState ? 'panel' : 'compact')
  const surfaceActive = surface === 'creator' || surface === 'launcher'
    ? true
    : requestedSurface
      ? isSurfaceActive(surface, snapshot.state)
    : snapshot.state !== 'HIDDEN'
  const palette = palettes[snapshot.settings.theme]
  const date = new Date(snapshot.now)
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  const notify = (message: string) => setFeedback((current) => ({ message, sequence: current.sequence + 1 }))
  const setSettingsOpen = (open: boolean) => {
    if (window.island) window.island.setSettingsOpen(open)
    else setSnapshot((current) => ({ ...current, state: open ? 'SETTINGS_OPEN' : 'EXPANDED' }))
  }
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
      notify('作品库保存失败')
      return false
    }
  }
  const setExpanded = (expanded: boolean) => {
    if (window.island) window.island.setExpanded(expanded)
    else setSnapshot((current) => ({ ...current, state: expanded ? 'EXPANDED' : 'COMPACT' }))
  }
  const resetGesture = () => {
    pointerStart.current = null
    gestureAxis.current = null
    pullTravel.current = 0
    setGestureActive(false)
    setGestureMode(null)
    setPullDistance(0)
    window.island?.setTriggerPull(0)
  }
  const updatePull = (deltaY: number) => {
    const pull = Math.max(0, Math.min(8, deltaY))
    const travel = Math.max(pullTravel.current, Math.abs(deltaY))
    pullTravel.current = travel
    setPullDistance(pull)
    window.island?.setTriggerPull(pull)
    return { pull, travel }
  }
  const updateGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current) return
    const deltaX = event.screenX - pointerStart.current.x
    const deltaY = event.screenY - pointerStart.current.y
    if (!gestureAxis.current) {
      gestureAxis.current = resolveTriggerGestureAxis(deltaX, deltaY)
      setGestureMode(gestureAxis.current)
      if (gestureAxis.current === 'horizontal') window.island?.moveTrigger('start', pointerStart.current.x)
    }
    if (gestureAxis.current === 'horizontal') {
      setPullDistance(0)
      window.island?.setTriggerPull(0)
      window.island?.moveTrigger('move', event.screenX)
    } else if (gestureAxis.current === 'vertical') {
      updatePull(deltaY)
    }
  }
  const finishGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current) return
    const deltaX = event.screenX - pointerStart.current.x
    const deltaY = event.screenY - pointerStart.current.y
    const axis = gestureAxis.current ?? resolveTriggerGestureAxis(deltaX, deltaY)
    if (axis === 'horizontal' && !gestureAxis.current) window.island?.moveTrigger('start', pointerStart.current.x)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (axis === 'horizontal') {
      window.island?.moveTrigger('end', event.screenX)
      resetGesture()
      return
    }
    const gesture = updatePull(deltaY)
    resetGesture()
    if (shouldRevealFromTrigger(gesture.pull, Math.max(gesture.travel, Math.abs(deltaX)))) setExpanded(false)
  }

  return (
    <main
      className={`stage surface-${surface} ${surfaceActive ? 'isActive' : 'isInactive'}`}
      style={{
        '--bg': palette[0],
        '--fg': palette[1],
        '--accent': palette[2],
        '--panel': palette[3],
        '--alpha': snapshot.settings.opacity,
        '--cloud-color': snapshot.settings.fluidCloud.color,
        '--cloud-speed': snapshot.settings.fluidCloud.speed,
        '--cloud-response': snapshot.settings.fluidCloud.response,
        '--cloud-depth': snapshot.settings.fluidCloud.depth,
        '--cloud-curvature': snapshot.settings.fluidCloud.curvature,
        '--cloud-symmetry': snapshot.settings.fluidCloud.symmetry,
        '--pull-distance': `${pullDistance}px`,
        '--pull-scale': 1 + pullDistance / 30
      } as React.CSSProperties}
    >
      <section className="surfaceFrame">
        {surface === 'creator' ? (
          <CloudStudio
            settings={snapshot.settings}
            onCloudChange={updateFluidCloud}
            onSettingsChange={updateGeneralSettings}
            onCreationsChange={updateCreations}
            notify={notify}
          />
        ) : surface === 'launcher' ? (
          <LauncherManager state={launcherState} onStateChange={setLauncherState} notify={notify} />
        ) : surface === 'trigger' ? (
          <button
            className={`triggerControl style-${snapshot.settings.fluidCloud.shape} ${gestureActive ? 'is-dragging' : ''} ${gestureMode ? `gesture-${gestureMode}` : ''}`}
            type="button"
            aria-label="点击、下拉或横向拖动灵动岛"
            onClick={(event) => { if (event.detail === 0) setExpanded(false) }}
            onPointerDown={(event) => {
              if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
              pointerStart.current = { x: event.screenX, y: event.screenY }
              gestureAxis.current = null
              pullTravel.current = 0
              setGestureActive(true)
              setGestureMode(null)
              setPullDistance(0)
              window.island?.setTriggerPull(0)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={updateGesture}
            onPointerUp={finishGesture}
            onPointerCancel={() => {
              if (gestureAxis.current === 'horizontal') window.island?.moveTrigger('cancel', 0)
              resetGesture()
            }}
          >
            <span className="triggerArtworkMotion">
              <TriggerArtwork style={snapshot.settings.fluidCloud.shape} cloud={snapshot.settings.fluidCloud} active={surfaceActive} />
            </span>
          </button>
        ) : surface === 'compact' ? (
            <button className="compact" type="button" onClick={() => setExpanded(true)} aria-label="展开灵动岛">
              <span className="compactHalo" aria-hidden /><time>{time}</time><span className="pulse" />
            </button>
        ) : (
          <div className="panel">
            <div className="dashboardPanel">
                <div className="panelChrome">
                  <span className="liveStatus"><Waves size={15} strokeWidth={2} />灵动中心</span>
                  <span className="panelClock"><time>{time}</time><small>{formatDate(date)}</small></span>
                  <div className="panelTools">
                    <button className="roundButton" type="button" onClick={() => setExpanded(false)} aria-label="收起" title="收起"><ChevronDown size={18} /></button>
                  </div>
                </div>

                <div className="launcherGrid" aria-label="快捷入口">
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
                  <button className="launcherTile fixed" title="流云创作器" type="button" onClick={() => setSettingsOpen(true)}>
                    <span><Waves size={22} /></span>
                    <b>创作</b>
                  </button>
                </div>
            </div>
          </div>
        )}
        {feedback.message && <p className="feedbackToast" role="status" aria-live="polite">{feedback.message}</p>}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
