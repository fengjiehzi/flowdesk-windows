import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { DesktopBoxesController } from './desktopBoxes'
import { desktopBoxesMessageSchema } from '../shared/desktopBoxes'

const executablePath = path.resolve('build/generated/desktop-boxes/SmartDeskBox.DesktopApp.exe')
assert.ok(existsSync(executablePath), '请先运行 npm run desktop:build')
mkdirSync(path.resolve('output'), { recursive: true })
const root = mkdtempSync(path.resolve('output/desktop-boxes-test-'))
const dataPath = path.join(root, '隔离用户数据')
const states: unknown[] = []
const enabledChanges: boolean[] = []
const controller = new DesktopBoxesController({
  executablePath, dataPath, enabled: false, probe: true,
  onState: state => states.push(state), onEnabledChange: enabled => enabledChanges.push(enabled)
})

try {
  assert.equal((await controller.command('state')).running, false)
  assert.equal(existsSync(dataPath), false, '读取停用状态不能启动模块或创建数据')
  await controller.command('hide')
  assert.deepEqual(enabledChanges, [false], '模块未运行时也能关闭自动恢复')
  await assert.rejects(controller.command('delete'), /Invalid enum/)
  await assert.rejects(controller.command('exit'), /仅由流屿桌面主进程/)
  await assert.rejects(controller.command('manage'), /协议测试不操作真实桌面/)
  assert.equal((await controller.command('state')).running, true)
  assert.equal(controller.getState().active, false)
  assert.ok(existsSync(path.join(dataPath, 'data', 'smartdeskbox.db')), '中文数据路径应传入原生模块')
  assert.ok(!existsSync(path.join(dataPath, 'desktop_classification_report.json')), '测试不能扫描真实桌面')
  await controller.shutdown()
  assert.equal(controller.getState().running, false)
  await assert.rejects(controller.command('show'), /协议测试不操作真实桌面/)
  await controller.shutdown()
  assert.ok(states.length >= 4)
} finally { await controller.shutdown() }

// Exercise native invalid-command handling and orphan cleanup without touching Explorer.
const child = spawn(executablePath, ['--island-probe', '--island-data', path.join(root, '父进程断开')], { windowsHide: true, stdio: 'pipe' })
const lines = createInterface({ input: child.stdout })
const exit = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
const timeout = setTimeout(() => { child.stdin.end() }, 10_000)
let ready = false
let idleResponsive = false
let rejected = false
try {
  for await (const line of lines) {
    const message = desktopBoxesMessageSchema.parse(JSON.parse(line))
    if (message.ready) {
      ready = true
    } else if (ready && !idleResponsive && message.id === undefined) {
      idleResponsive = true
      child.stdin.write(`${JSON.stringify({ id: 1, action: 'delete' })}\n`)
    }
    if (message.id === 1) {
      assert.equal(message.ok, false)
      assert.match(message.error ?? '', /不支持/)
      rejected = true
      child.stdin.end()
    }
  }
  assert.equal(await exit, 0, '父进程关闭输入管道后原生模块应退出')
  assert.ok(ready && idleResponsive && rejected, '等待输入命令时原生 UI 线程必须继续响应')
} finally { clearTimeout(timeout); lines.close(); child.stdin.end() }

const missing = new DesktopBoxesController({ executablePath: path.join(root, 'missing.exe'), dataPath, enabled: false, onState: () => {}, onEnabledChange: () => {} })
await assert.rejects(missing.command('show'), /desktop:build/)
console.log('PASS desktop boxes: idle state, command validation, native protocol, Unicode data path, restart, graceful exit, idle UI response, parent disconnect, missing module')
