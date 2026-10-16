import React, { useEffect, useRef, useState } from 'react'
import { AppWindow, ArrowRight, File, FileCode2, Folder, FolderPlus, Globe2, LayoutGrid, Plus, Search, Settings, Waves, X } from 'lucide-react'
import { looksLikeLocalPath, type LauncherEntryView, type LauncherSearchItem, type LauncherSearchRequest, type LauncherState } from '../../shared/launcher'
import { DesktopBoxesControls } from './DesktopBoxesControls'

export function LaunchItemIcon({ entry }: { entry: Pick<LauncherEntryView, 'kind' | 'icon'> }) {
  if (entry.icon) return <img src={entry.icon} alt="" />
  const Icon = entry.kind === 'website' ? Globe2 : entry.kind === 'folder' ? Folder : entry.kind === 'script' ? FileCode2 : entry.kind === 'file' ? File : AppWindow
  return <Icon size={30} strokeWidth={1.6} />
}

type Props = {
  state: LauncherState
  active: boolean
  onStateChange: (state: LauncherState) => void
  onManage: () => void
  onCreator: () => void
  onSettings: () => void
  onCollapse: () => void
  notify: (message: string) => void
}

export function LauncherWorkspace({ state, active, onStateChange, onManage, onCreator, onSettings, onCollapse, notify }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LauncherSearchItem[]>([])
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [scanError, setScanError] = useState('')
  const [scanRevision, setScanRevision] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [recentExpanded, setRecentExpanded] = useState(false)
  const [localsExpanded, setLocalsExpanded] = useState(false)
  const [pathConfirmed, setPathConfirmed] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const pathActionRef = useRef<HTMLButtonElement>(null)
  const operation = useRef(false)
  const dragDepth = useRef(0)
  const localEntries = state.localEntries ?? []
  const recentEntries = state.recentEntries ?? []
  const pathQuery = looksLikeLocalPath(query)
  const tools = [
    { id: 'desktop', name: '桌面整理', detail: '桌面盒子、分类与备份', Icon: LayoutGrid, action: () => {
      if (!window.island) { notify('请在桌面程序中使用桌面整理'); return }
      void window.island.desktopBoxesCommand('manage').catch(reason => setError(reason instanceof Error ? reason.message : '无法打开桌面整理'))
    } },
    { id: 'manage', name: '本地启动管理', detail: '添加文件、文件夹或脚本', Icon: FolderPlus, action: onManage },
    { id: 'creator', name: '流云创作器', detail: '调整灵动岛外观', Icon: Waves, action: onCreator },
    { id: 'settings', name: '设置', detail: '通知与通用设置', Icon: Settings, action: onSettings }
  ].filter(item => item.name.includes(query.trim()))
  const choiceCount = results.length + tools.length

  useEffect(() => {
    if (!active) { setQuery(''); setError(''); setPathConfirmed(false); return }
    searchRef.current?.focus()
    if (!window.island) return
    let live = true
    window.island.discoverInstalledApps().then(() => {
      if (live) { setScanError(''); setScanRevision(value => value + 1) }
    }).catch(() => { if (live) setScanError('应用扫描暂不可用，本地启动和固定入口仍可搜索。') })
    return () => { live = false }
  }, [active])

  useEffect(() => {
    setSelected(0)
    setPathConfirmed(false)
    if (!active || !query.trim() || pathQuery) { setResults([]); setSearching(false); return }
    let live = true
    setSearching(true)
    const timer = window.setTimeout(() => {
      const request = window.island ? window.island.searchLaunchItems(query) : Promise.resolve(
        [...localEntries.map(item => ({ ...item, source: 'local' as const, detail: item.path })), ...state.entries.map(item => ({ ...item, source: 'entry' as const, detail: '已固定' }))]
          .filter(item => `${item.name} ${item.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      )
      request.then(items => { if (live) { setResults(items); setSearching(false) } }).catch(reason => {
        if (live) { setResults([]); setSearching(false); setError(reason instanceof Error ? reason.message : '搜索失败，请重试') }
      })
    }, 120)
    return () => { live = false; window.clearTimeout(timer) }
  }, [query, active, pathQuery, state, scanRevision])

  useEffect(() => { if (pathConfirmed) pathActionRef.current?.focus() }, [pathConfirmed])
  useEffect(() => {
    if (query.trim() && !pathQuery) document.getElementById(`launch-choice-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, query, pathQuery])

  const register = async (action: () => Promise<LauncherState>) => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      const next = await action()
      const count = next.localEntries.length - localEntries.length
      onStateChange(next)
      setQuery('')
      notify(count > 0 ? `已加入 ${count} 个本地启动项` : '该路径已在本地启动中')
      searchRef.current?.focus()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '添加失败，请重试') }
    finally { operation.current = false; setBusy(false) }
  }

  const registerPath = () => void register(() => window.island
    ? window.island.registerLocalPaths([query])
    : Promise.reject(new Error('请在桌面程序中添加本地路径')))

  const launch = async (item: LauncherSearchRequest & { name: string }) => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      if (window.island) {
        const result = await window.island.launchSearchItem({ source: item.source, id: item.id })
        if (!result.recentSaved) notify('已打开，最近使用记录保存失败')
      } else notify(`预览：打开 ${item.name}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '启动失败，请检查文件是否存在') }
    finally { operation.current = false; setBusy(false) }
  }

  const submitChoice = () => {
    if (searching || busy) return
    if (pathQuery) { setPathConfirmed(true); return }
    if (selected < results.length) {
      const result = results[selected]
      if (result) void launch(result)
    } else tools[selected - results.length]?.action()
  }

  const group = (title: string, entries: LauncherEntryView[], source: LauncherSearchRequest['source'], expanded?: boolean, toggle?: () => void) => (
    <section className="launchGroup" aria-label={title}>
      <header><h2>{title}</h2>{toggle && entries.length > 8 && <button type="button" onClick={toggle}>{expanded ? '收起' : `展开 (${entries.length})`}</button>}{source === 'entry' && <button type="button" onClick={onManage}>管理 <ArrowRight size={12} /></button>}</header>
      {entries.length ? <div className="launchIconGrid">{(expanded ? entries : entries.slice(0, 8)).map(item => (
        <button className="launchWorkspaceTile" key={item.id} type="button" disabled={busy} title={item.name} onClick={() => void launch({ ...item, source })}>
          <span><LaunchItemIcon entry={item} /></span><b>{item.name}</b>
        </button>
      ))}</div> : <p className="launchGroupEmpty">{source === 'recent' ? '打开应用或本地启动项后，最近使用会显示在这里。' : '把常用入口固定在这里，最多 8 个。'}</p>}
    </section>
  )

  return <div className={`launchWorkspace ${dragging ? 'isFileDrag' : ''}`} onKeyDown={event => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (query) { setQuery(''); searchRef.current?.focus() } else onCollapse()
  }} onDragEnter={event => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault(); dragDepth.current++; setDragging(true)
  }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDragLeave={event => {
    if (!event.dataTransfer.types.includes('Files')) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDragging(false)
  }} onDrop={event => {
    event.preventDefault(); dragDepth.current = 0; setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length) void register(() => window.island ? window.island.registerDroppedFiles(files) : Promise.reject(new Error('请在桌面程序中拖入本地文件')))
  }}>
    <form className="launchSearchBar" onSubmit={event => { event.preventDefault(); submitChoice() }}>
      <Search size={21} aria-hidden />
      <input ref={searchRef} value={query} maxLength={32767} placeholder="搜索应用、本地启动，或输入完整路径" aria-label="搜索应用、本地启动或路径" role="combobox" aria-expanded={Boolean(query.trim())} aria-controls="launch-search-results" aria-activedescendant={!pathQuery && query.trim() && choiceCount ? `launch-choice-${selected}` : undefined} autoComplete="off" onChange={event => { setQuery(event.target.value); setError('') }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp'].includes(event.key) || !choiceCount || pathQuery) return
        event.preventDefault()
        setSelected(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + choiceCount) % choiceCount)
      }} />
      {query && <button type="button" aria-label="清空搜索" onClick={() => { setQuery(''); searchRef.current?.focus() }}><X size={16} /></button>}
      <kbd>↵</kbd>
    </form>
    <div className="launchWorkspaceBody">
      {query.trim() ? <div className="launchSearchResults" id="launch-search-results" role="listbox" aria-label="启动项搜索结果" aria-busy={searching}>
        {pathQuery ? <div className="launchPathAction"><FolderPlus size={30} /><div><b>{pathConfirmed ? '加入本地启动' : '添加这个本地路径'}</b><p>{query}</p><small>添加后即可按名称搜索。文件、脚本和文件夹均可添加。</small></div><button ref={pathActionRef} type="button" disabled={busy} onClick={registerPath}><Plus size={15} />{busy ? '正在添加…' : '加入本地启动'}</button></div> : <>
          {searching && <p className="launchGroupEmpty" role="status">正在搜索…</p>}
          {results.map((item, index) => <button key={`${item.source}:${item.id}`} id={`launch-choice-${index}`} role="option" aria-selected={selected === index} type="button" className={`launchSearchRow ${selected === index ? 'isSelected' : ''}`} disabled={busy} onMouseEnter={() => setSelected(index)} onClick={() => void launch(item)}><span><LaunchItemIcon entry={item} /></span><div><b>{item.name}</b><small title={item.detail}>{item.detail}</small></div><em>{item.source === 'local' ? '本地启动' : item.source === 'entry' ? '已固定' : item.source === 'recent' ? '最近使用' : '应用'}</em><ArrowRight size={15} /></button>)}
          {tools.map((item, index) => <button key={item.id} id={`launch-choice-${results.length + index}`} role="option" aria-selected={selected === results.length + index} type="button" className={`launchSearchRow ${selected === results.length + index ? 'isSelected' : ''}`} onMouseEnter={() => setSelected(results.length + index)} onClick={item.action}><span><item.Icon size={28} /></span><div><b>{item.name}</b><small>{item.detail}</small></div><em>功能</em><ArrowRight size={15} /></button>)}
          {!searching && !choiceCount && <div className="launchNoResults"><Search size={28} /><b>没有找到匹配项</b><p>换个名称试试，或输入完整路径加入本地启动。</p><button type="button" onClick={onManage}>管理本地启动</button></div>}
        </>}
      </div> : <>
        <DesktopBoxesControls active={active} />
        {group('最近使用', recentEntries, 'recent', recentExpanded, () => setRecentExpanded(value => !value))}
        {group('已固定', state.entries, 'entry')}
        {localEntries.length ? group('本地启动', localEntries, 'local', localsExpanded, () => setLocalsExpanded(value => !value)) : <section className="launchLocalDrop"><FolderPlus size={24} /><div><b>把本地文件放进启动台</b><p>拖入绿色软件、文件、脚本或文件夹，之后按名称即可找到。</p></div><button type="button" onClick={onManage}>添加 <Plus size={14} /></button></section>}
      </>}
      {scanError && <p className="launchScanNotice" role="status">{scanError}</p>}
    </div>
    {error && <div className="launchError" role="alert">{error}<button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={14} /></button></div>}
    {dragging && <div className="launchDropOverlay"><FolderPlus size={34} /><b>松开以加入本地启动</b><p>只添加启动项，不会立即执行文件</p></div>}
  </div>
}
