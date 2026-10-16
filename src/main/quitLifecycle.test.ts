import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

for (const outcome of ['cancel', 'complete', 'restore-error'] as const) {
  test(`application quit handles ${outcome} without losing the desktop preference`, async () => {
    const source = ts.createSourceFile('index.ts', readFileSync(new URL('./index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
    const registration = source.statements.find(statement => ts.isExpressionStatement(statement)
      && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(source) === 'app.on'
      && statement.expression.arguments[0]?.getText(source) === "'before-quit'")
    assert.ok(registration && ts.isExpressionStatement(registration) && ts.isCallExpression(registration.expression))
    const callback = registration.expression.arguments[1].getText(source)
    const calls: string[] = []
    const context = {
      quitReady: false, quitStarted: false, creatorWindow: null, settingsWindow: null, launcherWindow: null, tray: null,
      prepareWindowClose: async () => true, log: () => {}, cleanupTimers: () => {},
      app: { quit: () => calls.push('quit') }, globalShortcut: { unregisterAll: () => {} },
      desktopBoxesController: {
        shutdown: async () => { calls.push('desktop-stop') },
        restore: async () => { calls.push('desktop-restore'); if (outcome === 'restore-error') throw new Error('restore failed') }
      },
      notificationController: { shutdown: async () => outcome === 'complete', configure: () => calls.push('notifications-resume') },
      dialog: { showErrorBox: () => calls.push('restore-error') }
    }
    const handler = vm.runInNewContext(ts.transpileModule(`const handler = ${callback}; handler`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
    }).outputText, context) as (event: { preventDefault: () => void }) => void
    handler({ preventDefault: () => {} })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, outcome === 'complete' ? ['desktop-stop', 'quit']
      : ['desktop-stop', 'notifications-resume', 'desktop-restore', ...(outcome === 'restore-error' ? ['restore-error'] : [])])
    assert.equal(context.quitStarted, outcome === 'complete')
  })
}
