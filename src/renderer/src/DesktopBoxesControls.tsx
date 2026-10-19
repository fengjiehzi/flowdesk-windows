import { useEffect, useState } from 'react'
import { LayoutGrid, RefreshCw, Settings } from 'lucide-react'
import type { DesktopBoxesAction, DesktopBoxesState } from '../../shared/desktopBoxes'

export function DesktopBoxesControls({ active }: { active: boolean }) {
  const [state, setState] = useState<DesktopBoxesState>({ running: false, active: false, busy: false })
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!active || !window.island) return
    let live = true
    const unsubscribe = window.island.onDesktopBoxesState(value => { if (live) setState(value) })
    window.island.getDesktopBoxesState().then(value => { if (live) setState(value) }).catch(reason => {
      if (live) setError(reason instanceof Error ? reason.message : '无法读取桌面整理状态')
    })
    return () => { live = false; unsubscribe() }
  }, [active])

  const command = async (action: Exclude<DesktopBoxesAction, 'exit'>) => {
    if (working) return
    setWorking(true)
    setError('')
    try {
      if (!window.island) throw new Error('请在流屿桌面程序中使用桌面整理')
      setState(await window.island.desktopBoxesCommand(action))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '桌面整理操作失败') }
    finally { setWorking(false) }
  }

  const disabled = working || state.busy
  return <section className="desktopBoxesControls" aria-label="桌面整理" aria-busy={disabled}>
    <div className="desktopBoxesHeading"><LayoutGrid size={22} aria-hidden /><div><b>桌面整理</b><p role="status">{working ? '正在处理…' : state.busy ? '正在整理，请稍候…' : state.active ? '桌面盒子已启用 · 自动分类与布局记忆' : '将桌面应用与文件分区显示，分类保留原文件位置'}</p></div></div>
    <div className="desktopBoxesActions">
      <button type="button" disabled={disabled} onClick={() => void command(state.active ? 'hide' : 'show')}>{state.active ? '恢复系统桌面' : '启用桌面盒子'}</button>
      <button type="button" disabled={disabled} onClick={() => void command('manage')}>分类与备份</button>
      <button type="button" disabled={disabled} title="桌面整理设置" aria-label="桌面整理设置" onClick={() => void command('settings')}><Settings size={15} /></button>
      <button type="button" disabled={disabled} title="重新扫描桌面" aria-label="重新扫描桌面" onClick={() => void command('refresh')}><RefreshCw size={15} /></button>
    </div>
    {(error || state.error) && <p className="desktopBoxesError" role="alert">{error || state.error}</p>}
  </section>
}
