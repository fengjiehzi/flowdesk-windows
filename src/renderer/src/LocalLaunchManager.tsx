import React, { useRef, useState } from 'react'
import { FilePlus2, FolderPlus, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import type { LauncherState } from '../../shared/launcher'
import { LaunchItemIcon } from './LauncherWorkspace'

export function LocalLaunchManager({ state, onStateChange, notify }: { state: LauncherState; onStateChange: (state: LauncherState) => void; notify: (message: string) => void }) {
  const [path, setPath] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const pending = useRef(false)
  const entries = state.localEntries ?? []
  const visible = entries.filter(item => `${item.name} ${item.path}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const run = async (action: () => Promise<LauncherState | null>, message: string) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const next = await action()
      if (next) { onStateChange(next); notify(message); return true }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试') }
    finally { pending.current = false; setBusy(false) }
    return false
  }
  const unavailable = () => Promise.reject(new Error('请在桌面程序中管理本地启动'))
  const addPath = async (event: React.FormEvent) => {
    event.preventDefault()
    if (await run(() => window.island ? window.island.registerLocalPaths([path]) : unavailable(), '本地启动已更新')) setPath('')
  }
  return <div className="localLaunchManager" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    if (files.length) void run(() => window.island ? window.island.registerDroppedFiles(files) : unavailable(), '已加入本地启动')
  }}>
    <header><div><h2>本地启动</h2><p>把绿色软件、任意文件、脚本和文件夹注册为可搜索的启动项。</p></div><span>{entries.length} 项</span></header>
    <div className="localLaunchAdd">
      <form onSubmit={event => void addPath(event)}><label htmlFor="local-launch-path">文件或文件夹的完整路径</label><div><input id="local-launch-path" value={path} onChange={event => setPath(event.target.value)} placeholder="例如 D:\工具\便携软件.exe" maxLength={32767} required /><button type="submit" disabled={busy || !path.trim()}><Plus size={15} />添加</button></div></form>
      <div className="localLaunchPick"><button type="button" disabled={busy} onClick={() => void run(() => window.island ? window.island.pickLocalTargets('files') : unavailable(), '文件已加入本地启动')}><FilePlus2 size={16} />选择文件或脚本</button><button type="button" disabled={busy} onClick={() => void run(() => window.island ? window.island.pickLocalTargets('folder') : unavailable(), '文件夹已加入本地启动')}><FolderPlus size={16} />选择文件夹</button><small>也可以把文件直接拖到此窗口</small></div>
      <p className="localLaunchHelp">添加不会执行文件；启动时按 Windows 默认关联打开或运行脚本。移除启动项会保留原文件。</p>
    </div>
    {error && <div className="localLaunchError" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={14} /></button></div>}
    <label className="localLaunchFilter"><Search size={16} /><input aria-label="搜索已注册本地启动项" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称或路径" /></label>
    <div className="localLaunchList" aria-busy={busy}>
      {visible.map(item => {
        const pinned = state.entries.some(entry => entry.id === item.id)
        return <div className="localLaunchRow" key={item.id}>
          <span className="localLaunchIcon"><LaunchItemIcon entry={item} /></span>
          <div><input aria-label={`重命名本地启动 ${item.name}`} maxLength={24} value={names[item.id] ?? item.name} disabled={busy} onChange={event => setNames(current => ({ ...current, [item.id]: event.target.value }))} onBlur={() => {
            if (names[item.id] === undefined || names[item.id] === item.name) return
            void run(() => window.island ? window.island.renameShortcut(item.id, names[item.id]) : unavailable(), '启动项名称已更新')
          }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); setNames(current => ({ ...current, [item.id]: item.name })) } }} /><small title={item.path}>{item.path}</small></div>
          <button type="button" disabled={busy} title={pinned ? '取消固定' : '固定到展开面板，最多 8 个'} aria-label={`${pinned ? '取消固定' : '固定'} ${item.name}`} onClick={() => void run(() => window.island ? window.island.pinLocalLaunch(item.id, !pinned) : unavailable(), pinned ? '已取消固定' : '已固定到展开面板')}>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
          <button type="button" disabled={busy} title="仅移除启动项，保留原文件" aria-label={`移除本地启动 ${item.name}`} onClick={() => void run(() => window.island ? window.island.removeLocalLaunch(item.id) : unavailable(), '启动项已移除，原文件保留')}><Trash2 size={16} /></button>
        </div>
      })}
      {!visible.length && <div className="localLaunchEmpty"><FolderPlus size={32} /><b>{entries.length ? '没有匹配的启动项' : '先添加一个本地启动项'}</b><p>{entries.length ? '换个名称或路径试试。' : '拖入文件，或从上方选择文件与文件夹。'}</p></div>}
    </div>
  </div>
}
