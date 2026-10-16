import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { test } from 'node:test'
import { isTrustedRendererUrl } from './rendererSecurity'

test('renderer trust is limited to the app file or exact development entry', () => {
  const file = path.resolve('src/renderer/index.html')
  assert.equal(isTrustedRendererUrl(`${pathToFileURL(file)}?surface=creator`, file), true)
  assert.equal(isTrustedRendererUrl(pathToFileURL(path.resolve('README.md')).toString(), file), false)
  assert.equal(isTrustedRendererUrl('https://example.com/', file), false)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5179/?surface=settings', file, 'http://127.0.0.1:5179/'), true)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5179/other', file, 'http://127.0.0.1:5179/'), false)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5180/', file, 'http://127.0.0.1:5179/'), false)
  assert.equal(isTrustedRendererUrl('http://user:pass@127.0.0.1:5179/', file, 'http://127.0.0.1:5179/'), false)
})
