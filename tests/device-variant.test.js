const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const profile = {"name": "红米手表5", "base": "环10", "shape": "rect", "physical": [432, 514], "css": [216, 257], "version": 20}

function filesUnder(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...filesUnder(full))
    else result.push(full)
  }
  return result
}

test('fixed device manifest and source profile are aligned', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'))
  assert.equal(manifest.config.designWidth, profile.css[0])
  assert.equal(manifest.versionCode, profile.version)
  assert.ok(manifest.pages.includes('pages/detail'))
})

test('fixed source has no runtime multi-screen media queries', () => {
  for (const file of filesUnder(path.join(root, 'src')).filter(file => file.endsWith('.ux'))) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /@media\s*\(/, file)
})

test('reader retains explicit body/face layers and menu icon', () => {
  const detail = fs.readFileSync(path.join(root, 'src/pages/detail/detail.ux'), 'utf8')
  assert.match(detail, /stageSingleBody/)
  assert.match(detail, /stageSingleFace/)
  assert.match(detail, /menu-bar-top/)
  assert.doesNotMatch(detail, /class=\"menu-trigger\">菜单/)
  assert.match(detail, /handleGameClick\(\)/)
})

test('character slots keep heads inside the viewport', () => {
  const detail = fs.readFileSync(path.join(root, 'src/pages/detail/detail.ux'), 'utf8')
  assert.match(detail, /\.person-duo-left \{[^}]*top: 0px;[^}]*bottom: auto;[^}]*height: (?:330|340|360)px/)
  assert.match(detail, /\.person-duo-right \{[^}]*top: 0px;[^}]*bottom: auto;[^}]*height: (?:330|340|360)px/)
})

test('navigation and resources remain device-safe', () => {
  const cg = fs.readFileSync(path.join(root, 'src/pages/cg-viewer/cg-viewer.ux'), 'utf8')
  assert.doesNotMatch(cg, /transform: rotate\(90deg\)/)
  assert.match(cg, /handleTouchStart\(event\)/)
  assert.match(cg, /blockSystemBack\(\)/)
  assert.equal(filesUnder(path.join(root, 'src')).filter(file => /\.json$/i.test(file) && path.basename(file) !== 'manifest.json').length, 0)
  assert.equal(filesUnder(path.join(root, 'src')).filter(file => /\.(jpg|jpeg|webp)$/i.test(file)).length, 0)
  assert.equal(filesUnder(path.join(root, 'src/common')).filter(file => file.includes('ev-viewer')).length, 0)
})
