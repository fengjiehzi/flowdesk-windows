import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mock, test } from 'node:test'

let child: ReturnType<typeof createChild>
function createChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null
  })
}
mock.module('node:child_process', { namedExports: { spawn: () => { child = createChild(); return child } } })
const { DesktopBoxesController } = await import('./desktopBoxes')

for (const acknowledge of [true, false]) {
  test(`desktop shutdown ${acknowledge ? 'accepts a late acknowledgement' : 'rejects a missing acknowledgement'} after process exit`, async () => {
    const enabledChanges: boolean[] = []
    const controller = new DesktopBoxesController({
      executablePath: process.execPath, dataPath: 'unused', enabled: true,
      onState: () => {}, onEnabledChange: enabled => enabledChanges.push(enabled)
    })
    const restoring = controller.restore()
    const state = { running: true, active: true, busy: false }
    child.stdout.write(`${JSON.stringify({ ready: true, state })}\n`)
    await restoring
    enabledChanges.length = 0
    const stopped = controller.shutdown().then(() => true, () => false)
    const request = JSON.parse(child.stdin.read().toString()) as { id: number; action: string }
    assert.equal(request.action, 'exit')
    child.exitCode = 0
    child.emit('exit', 0)
    if (acknowledge) child.stdout.write(`${JSON.stringify({ id: request.id, ok: true, state })}\n`)
    child.stdout.end()
    child.emit('close', 0)
    assert.equal(await stopped, acknowledge)
    assert.deepEqual(enabledChanges, [], 'Shutdown must retain the preference used to restore after cancellation')
    assert.equal(controller.getState().running, false)
  })
}
