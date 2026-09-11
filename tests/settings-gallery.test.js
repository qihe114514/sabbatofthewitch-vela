const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

function loadReaderSettings() {
  const source = fs.readFileSync(path.join(root, 'src/common/reader-settings.js'), 'utf8')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    .replace(/export default[\s\S]*$/m, 'module.exports = { DEFAULT_READER_SETTINGS, normalizeReaderSettings, getAutoAdvanceDelay }')
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports })
  return module.exports
}

function loadCatalog() {
  const source = fs.readFileSync(path.join(root, 'src/common/cg-catalog.js'), 'utf8')
    .replace(/import resourceManifest from '\.\/resource-manifest\.js'/, "const resourceManifest = { paths: { ev: { ev101aa: '/common/ev/ev101.png', ev101ab: '/common/ev/ev101.png', ev201aa: '/common/ev/ev201.png', ev601aa: '/common/ev/ev601.png', sd101: '/common/sd/寧々.png' } } }")
    .replace(/export function /g, 'function ')
    .replace(/export default[\s\S]*$/m, 'module.exports = { getCgGroups, getCgGroup, getCgItem }')
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports })
  return module.exports
}

function loadDisplayNames() {
  const source = fs.readFileSync(path.join(root, 'src/common/display-names.js'), 'utf8')
    .replace(/export function /g, 'function ')
    .replace(/export default[\s\S]*$/m, 'module.exports = { toDisplayCharacterName }')
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports })
  return module.exports
}

test('display names use Chinese translations while unknown names stay unchanged', () => {
  const { toDisplayCharacterName } = loadDisplayNames()
  assert.equal(toDisplayCharacterName('寧々'), '宁宁')
  assert.equal(toDisplayCharacterName('めぐる'), '爱瑠')
  assert.equal(toDisplayCharacterName('紬'), '䌷')
  assert.equal(toDisplayCharacterName('柊史'), '柊史')
})

test('reader settings normalize legacy values and default to medium', () => {
  const { DEFAULT_READER_SETTINGS, normalizeReaderSettings } = loadReaderSettings()
  assert.equal(DEFAULT_READER_SETTINGS.autoPlaySpeed, 'medium')
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeReaderSettings({ textSpeed: 'bad', autoPlaySpeed: 'unknown' }))), {
    textSpeed: 25, textSize: 22, autoPlay: false, autoPlaySpeed: 'medium'
  })
  assert.equal(normalizeReaderSettings({ autoPlay: 1, autoPlaySpeed: 'fast' }).autoPlaySpeed, 'fast')
})

test('auto advance delay follows speed and bounds', () => {
  const { getAutoAdvanceDelay } = loadReaderSettings()
  const short = getAutoAdvanceDelay('短句', 'fast')
  assert.equal(short, 1400)
  assert.ok(getAutoAdvanceDelay('中等长度的文本'.repeat(10), 'slow') > getAutoAdvanceDelay('中等长度的文本'.repeat(10), 'medium'))
  assert.ok(getAutoAdvanceDelay('很长'.repeat(300), 'slow') <= 9000)
})

test('CG catalog deduplicates aliases and groups event prefixes', () => {
  const { getCgGroups, getCgGroup, getCgItem } = loadCatalog()
  const groups = getCgGroups()
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map((group) => group.id))), ['common', 'nene', 'meguru', 'tsumugi', 'akogare', 'wakana'])
  assert.deepEqual(JSON.parse(JSON.stringify(getCgGroup('nene').items.map((item) => item.id))), ['ev101'])
  assert.equal(getCgItem('common', 0).id, 'ev601')
  assert.equal(getCgItem('missing', 0), null)
})

test('both device manifests and entry pages expose the new navigation', () => {
  for (const device of ['环10', '环9Pro']) {
    const deviceRoot = path.resolve(root, '..', device)
    const manifest = JSON.parse(fs.readFileSync(path.join(deviceRoot, 'src/manifest.json'), 'utf8'))
    assert.ok(manifest.pages.includes('pages/gallery'))
    assert.ok(manifest.pages.includes('pages/cg-viewer'))
    const index = fs.readFileSync(path.join(deviceRoot, 'src/pages/index/index.ux'), 'utf8')
    const settings = fs.readFileSync(path.join(deviceRoot, 'src/pages/settings/settings.ux'), 'utf8')
    const gallery = fs.readFileSync(path.join(deviceRoot, 'src/pages/gallery/gallery.ux'), 'utf8')
    const saves = fs.readFileSync(path.join(deviceRoot, 'src/pages/saves/saves.ux'), 'utf8')
    const detail = fs.readFileSync(path.join(deviceRoot, 'src/pages/detail/detail.ux'), 'utf8')
    assert.match(index, /openGallery\(\)/)
    assert.doesNotMatch(index, /openAbout\(\)/)
    assert.match(settings, /openAbout\(\)/)
    assert.match(settings, /setAutoPlaySpeed\('slow'\)/)
    assert.match(settings, /<scroll class="content" scroll-y="true"/)
    assert.doesNotMatch(settings, /当前：/)
    assert.ok(settings.indexOf('saveSettings') < settings.indexOf('resetSettings'))
    assert.ok(settings.indexOf('resetSettings') < settings.indexOf('openAbout'))
    assert.match(gallery, /<list-item type="thumb"/)
    assert.match(saves, /text-overflow: ellipsis; lines: 1/)
    assert.match(detail, /\.background-horizontal \{[^}]*object-fit: cover/)
    assert.match(detail, /blockBackgroundTouch\(\)/)
    assert.match(detail, /\.menu-trigger-hit \{[^}]*left: 70px/)
    assert.match(detail, /\.person-single \{[^}]*width: 248px/)
    assert.match(detail, /\.background-horizontal \{[^}]*width: 424px/)
    assert.match(detail, /class="menu-bar menu-bar-top"/)
    assert.doesNotMatch(detail, /class="menu-trigger">菜单/)
    assert.match(detail, /@click="handleGameClick" @longpress="enableUIHidden"/)
    assert.match(detail, /handleGameClick\(\)/)
    assert.match(detail, /enableUIHidden\(\)/)
    assert.match(detail, /stageSingleFace/)
    assert.doesNotMatch(detail, /stageSingleImage\.face/)
    assert.match(detail, /\.menu-trigger-hit \{[^}]*left: 70px/)
    const cg = fs.readFileSync(path.join(deviceRoot, 'src/pages/cg-viewer/cg-viewer.ux'), 'utf8')
    assert.match(cg, /class="viewer-stage"/)
    assert.doesNotMatch(cg, /transform: rotate\(90deg\)/)
    assert.match(cg, /item\.src \|\| ''/)
    assert.match(cg, /MIN_ZOOM = 1/)
    assert.match(cg, /maxZoom/)
    assert.match(cg, /this\.panY = 0/)
    assert.match(cg, /currentSize/)
    assert.match(cg, /style="\{\{canvasStyle\}\}"/)
    assert.match(cg, /handleTouchStart\(event\)/)
    assert.match(cg, /handleTouchMove\(event\)/)
    assert.match(cg, /handleTouchEnd\(event\)/)
    assert.match(cg, /applyZoomFromStart\(/)
    assert.match(cg, /blockSystemBack\(\) \{\}/)
    assert.match(cg, /@swipe="blockSystemBack"/)
    assert.match(cg, /\.arrow-left \{ top:/)
    assert.match(cg, /\.arrow-right \{ top:/)
    assert.match(cg, /\.back-btn \{[^}]*background-color: #302b33/)
  }
})

test('ring9Pro single character slot keeps the face visible below the top safe area', () => {
  const detail = fs.readFileSync(path.resolve(root, '..', '环9Pro', 'src/pages/detail/detail.ux'), 'utf8')
  assert.match(detail, /\.person-single \{[^}]*top: 48px/)
})

test('settings action buttons use the taller device-specific heights', () => {
  for (const device of ['环10', '环9Pro']) {
    const source = fs.readFileSync(path.resolve(root, '..', device, 'src/pages/settings/settings.ux'), 'utf8')
    assert.match(source, /\.primary-btn, \.secondary-btn, \.about-btn \{[^}]*height: 39px; line-height: 39px/)
    assert.match(source, /\.primary-btn, \.secondary-btn, \.about-btn \{ width: 184px; height: 30px; line-height: 30px/)
    assert.match(source, /\.primary-btn, \.secondary-btn, \.about-btn \{ width: 170px; height: 25px; line-height: 25px/)
  }
})

test('about page contains the requested attribution and safety notices', () => {
  for (const device of ['环10', '环9Pro']) {
    const about = fs.readFileSync(path.resolve(root, '..', device, 'src/pages/about/about.ux'), 'utf8')
    assert.match(about, /サノバウィッチ/)
    assert.match(about, /@其核/)
    assert.match(about, /1105166284/)
    assert.match(about, /故事介绍/)
    assert.match(about, /免责声明/)
    assert.match(about, /R18警告/)
    assert.doesNotMatch(about, /官方译名|游戏类型|目标设备|移植引擎/)
  }
})

test('navigation pages share the same return button contract', () => {
  for (const device of ['环10', '环9Pro']) {
    const deviceRoot = path.resolve(root, '..', device)
    for (const page of ['settings', 'saves', 'about', 'gallery', 'cg-viewer']) {
      const source = fs.readFileSync(path.join(deviceRoot, `src/pages/${page}/${page}.ux`), 'utf8')
      const base = source.match(/\.back-btn \{([^}]*)\}/)
      assert.ok(base, `${device}/${page} defines .back-btn`)
      assert.match(base[1], /width: 136px/)
      assert.match(base[1], /height: 38px/)
      assert.match(base[1], /background-color: #302b33/)
      assert.match(base[1], /border-radius: 10px/)
      assert.match(source, /\.back-btn \{ bottom: 3px; left: 29px; width: 175px; height: 25px/)
    }
  }
})
