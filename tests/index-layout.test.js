const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('index page width matches the configured design width', () => {
  const root = path.resolve(__dirname, '..')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'manifest.json'), 'utf8'))
  const indexPage = fs.readFileSync(path.join(root, 'src', 'pages', 'index', 'index.ux'), 'utf8')
  const pageWidth = Number(indexPage.match(/\.page \{ width: (\d+)px;/)[1])

  assert.equal(manifest.config.designWidth, pageWidth)
})
