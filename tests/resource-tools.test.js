const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const childProcess = require('node:child_process')
const vm = require('node:vm')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '..')
const { buildIndex } = require('../tools/index-visual-assets.js')

function loadResolver() {
  const source = fs.readFileSync(path.join(projectRoot, 'src', 'common', 'resource-resolver.js'), 'utf8')
    .replace(/import resourceManifest from '\.\/resource-manifest\.js'/, 'const resourceManifest = { paths: { bg: { "空_青空": "/common/bg/空_青空.png" }, sd: { "sd101a": "/common/sd/sd101a.png" }, ev: {}, overlay: {} } }')
    .replace(/let resourceManifest = \{ paths: \{\} \}/, 'let resourceManifest = { paths: { bg: { "空_青空": "/common/bg/空_青空.png" }, sd: { "sd101a": "/common/sd/sd101a.png" }, ev: {}, overlay: {} } }')
    .replace(/export function /g, 'function ')
  .replace(/export default[\s\S]*$/m, 'module.exports = { resolveBackground, resolveEvent, resolveCharacter, resolveCharacterLayers }')
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports })
  return module.exports
}

test('visual index discovers scenario references and existing backgrounds', () => {
  const index = buildIndex()
  assert.equal(index.source.files.length, 101)
  assert.equal(index.references.length, 3653)
  assert.ok(index.assets.bg.includes('空_青空'))
  assert.ok(index.references.some((item) => item.type === 'bg' && item.status === 'available'))
  assert.equal(index.references.filter((item) => item.status !== 'available').length, 0)
  assert.ok(index.paths.ev.ev101aa)
})

test('resource resolver creates stable Vela paths and preserves explicit paths', () => {
  const { resolveBackground, resolveEvent, resolveCharacter, resolveCharacterLayers } = loadResolver()
  assert.equal(resolveBackground('空_青空'), '/common/bg/空_青空.png')
  assert.equal(resolveEvent('ev125ba'), '')
  assert.equal(resolveEvent('sd101a'), '/common/sd/sd101a.png')
  assert.equal(resolveEvent('ch_effect'), '')
  assert.equal(resolveEvent('/common/ev/ev125ba.png'), '/common/ev/ev125ba.png')
  assert.equal(resolveCharacter('/common/sd/sd101a.jpg'), '/common/sd/sd101a.jpg')
  assert.equal(resolveCharacter('寧々', '07', '制服', { '寧々|07|制服': '/common/sd/sd101a.png' }), '/common/sd/sd101a.png')
  assert.equal(resolveCharacter('寧々', '07', '制服', {}), '')
  assert.deepEqual(JSON.parse(JSON.stringify(resolveCharacterLayers('寧々', '07', '制服', { '寧々|07|制服': '/common/sd/body.png' }, { '寧々|07|制服': '/common/sd/face.png' }))), { body: '/common/sd/body.png', face: '/common/sd/face.png' })
})

test('generated character map covers every scripted character tuple', () => {
  const map = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tools', 'generated', 'character-map.generated.json'), 'utf8'))
  const { characters } = require('../tools/generate-character-map.js')
  assert.equal(Object.keys(map).length, characters.size)
  assert.match(map['寧々|01|制服'], /^\/common\/sd\//)
})

test('generated face map covers mapped character tuples with same-canvas layers', () => {
  const bodyMap = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tools', 'generated', 'character-map.generated.json'), 'utf8'))
  const faceMap = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tools', 'generated', 'character-face-map.generated.json'), 'utf8'))
  assert.ok(Object.keys(faceMap).length > 0)
  for (const [key, face] of Object.entries(faceMap)) {
    assert.ok(bodyMap[key], `missing body for ${key}`)
    assert.match(face, /^\/common\/sd\/ch_[a-f0-9]+_face\.png$/)
    assert.ok(fs.existsSync(path.join(projectRoot, 'src', face.slice(1))))
  }
})

test('character representatives retain upper-body canvases instead of face-only crops', () => {
  const files = fs.readdirSync(path.join(projectRoot, 'src', 'common', 'sd')).filter((name) => name.endsWith('_body.png'))
  assert.ok(files.length > 0)
  const script = [
    'from PIL import Image',
    'from pathlib import Path',
    'import sys',
    'root=Path(sys.argv[1])',
    'bad=[]',
    'for path in sorted(root.glob("*_body.png")):',
    ' image=Image.open(path)',
    ' if image.height < 120 or image.height > 520: bad.append(path.name+":"+str(image.width)+"x"+str(image.height))',
    'print("OK" if not bad else "BAD:"+",".join(bad))'
  ].join('\n')
  const result = childProcess.execFileSync('py', ['-3', '-c', script, path.join(projectRoot, 'src', 'common', 'sd')], { encoding: 'utf8' }).trim()
  assert.equal(result, 'OK')
})

test('character body and face assets use a shared centered watch canvas', () => {
  const sd = path.join(projectRoot, 'src', 'common', 'sd')
  const files = fs.readdirSync(sd).filter((name) => name.endsWith('.png') && (name.endsWith('_body.png') || name.endsWith('_face.png')))
  assert.ok(files.length > 0)
  const script = [
    'from PIL import Image',
    'from pathlib import Path',
    'import sys',
    'root=Path(sys.argv[1])',
    'files=sorted(p for p in root.glob("*.png") if p.name.endswith("_body.png") or p.name.endswith("_face.png"))',
    'bad=[]',
    'for path in files:',
    ' image=Image.open(path)',
    ' if (image.width,image.height,image.mode)!=(212,520,"P"): bad.append(path.name)',
    ' bbox=image.convert("RGBA").getchannel("A").getbbox()',
    ' if bbox and not (0 <= bbox[0] < bbox[2] <= image.width and 0 <= bbox[1] < bbox[3] <= image.height): bad.append(path.name+":bad-bounds")',
    'print("OK" if not bad else "BAD:"+",".join(bad))'
  ].join('\n')
  const result = childProcess.execFileSync('py', ['-3', '-c', script, sd], { encoding: 'utf8' }).trim()
  assert.equal(result, 'OK')
})

test('face layers stay in the facial region instead of the canvas bottom', () => {
  const sd = path.join(projectRoot, 'src', 'common', 'sd')
  const script = [
    'from PIL import Image',
    'from pathlib import Path',
    'import sys',
    'root=Path(sys.argv[1])',
    'bad=[]',
    'for path in sorted(root.glob("*_face.png")):',
    ' box=Image.open(path).convert("RGBA").getchannel("A").getbbox()',
    ' if box and (box[1] > 300 or box[3] > 300): bad.append(path.name+":"+str(box))',
    'print("OK" if not bad else "BAD:"+",".join(bad[:5]))'
  ].join('\n')
  const result = childProcess.execFileSync('py', ['-3', '-c', script, sd], { encoding: 'utf8' }).trim()
  assert.equal(result, 'OK')
})

test('runtime manifest maps all direct SD commands to retained Q-style resources', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tools', 'generated', 'resource-manifest.json'), 'utf8'))
  assert.equal(Object.keys(manifest.paths.bg).length, 99)
  assert.equal(Object.keys(manifest.paths.sd).filter((name) => name.startsWith('sd')).length, 292)
  for (const target of [
    ...Object.values(manifest.paths.bg),
    ...Object.values(manifest.paths.sd),
    ...Object.values(manifest.paths.ev),
    ...Object.values(JSON.parse(fs.readFileSync(path.join(projectRoot, 'tools', 'generated', 'character-map.generated.json'), 'utf8')))
  ]) {
    assert.ok(fs.existsSync(path.join(projectRoot, 'src', target.slice(1))) || fs.existsSync(path.join(projectRoot, 'build', target.slice(1))))
  }
})

test('direct SD mappings prefer same-number event images and use body fallback for missing groups', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tools', 'generated', 'resource-manifest.json'), 'utf8'))
  assert.equal(manifest.paths.sd.sd101a, '/common/ev/ev101.png')
  assert.match(manifest.paths.sd.sd612a, /^\/common\/sd\/.*_body\.png$/)
  assert.ok(Object.values(manifest.paths.sd).some((target) => target.startsWith('/common/ev/')))
  assert.ok(Object.values(manifest.paths.sd).some((target) => target.startsWith('/common/sd/')))
})

test('runtime resolver returns the generated SD target', () => {
  const { resolveEvent } = loadResolver()
  assert.equal(resolveEvent('sd101a'), '/common/sd/sd101a.png')
})

test('scene asset descriptors contain only resources referenced by their scene', () => {
  const runtimeDir = path.join(projectRoot, 'src', 'common', 'runtime', 'scene-assets')
  const scenes = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src', 'common', 'runtime', 'scene-index.txt'), 'utf8'))
  const entries = Object.values(scenes).flat()
  assert.equal(fs.readdirSync(runtimeDir).filter((name) => name.endsWith('.txt')).length, entries.length)
  for (const scene of entries) {
    const descriptor = JSON.parse(fs.readFileSync(path.join(runtimeDir, `${scene.id}.txt`), 'utf8'))
    const script = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src', 'common', 'scn', scene.path), 'utf8'))
    const referenced = new Set(script.filter((node) => node[0] === 3 && Array.isArray(node[3])).flatMap((node) => node[3].map((entry) => `${entry[0]}|${entry[2] || ''}|${entry[3] || ''}`)))
    assert.ok(Object.keys(descriptor.characterMap).every((key) => referenced.has(key)))
    const targets = [
      ...Object.values(descriptor.characterMap),
      ...Object.values(descriptor.characterFaceMap),
      ...Object.values(descriptor.resourceManifest.paths.bg),
      ...Object.values(descriptor.resourceManifest.paths.sd),
      ...Object.values(descriptor.resourceManifest.paths.ev),
      ...Object.values(descriptor.resourceManifest.paths.overlay),
    ]
    for (const target of targets) {
      assert.ok(fs.existsSync(path.join(projectRoot, 'src', target.slice(1))))
    }
  }
})

test('background and transparent event conversion uses compact PNG output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanoba-assets-'))
  const source = path.join(dir, 'source.png')
  const target = path.join(dir, 'target.png')
  const background = path.join(dir, 'background.png')
  const script = [
    'from PIL import Image',
    'import importlib.util, sys',
    "spec=importlib.util.spec_from_file_location('assets', sys.argv[1])",
    'module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)',
    "image=Image.new('RGBA',(8,8),(255,0,0,0)); image.putpixel((4,4),(255,0,0,255)); image.save(sys.argv[2])",
    "module.convert(__import__('pathlib').Path(sys.argv[2]), __import__('pathlib').Path(sys.argv[3]), 'ev')",
    "module.convert(__import__('pathlib').Path(sys.argv[2]), __import__('pathlib').Path(sys.argv[4]), 'bg')",
    "result=Image.open(sys.argv[3]); assert result.mode == 'P'; assert result.size == (520,520); assert max(result.convert('RGB').getpixel((0,0))) < 20",
    "background=Image.open(sys.argv[4]); assert background.mode == 'P'; assert background.size == (424,520)"
  ].join('; ')
  try {
    childProcess.execFileSync('py', ['-3', '-c', script, path.join(projectRoot, 'tools', 'build-runtime-assets.py'), source, target, background])
    assert.ok(fs.statSync(target).size > 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('all direct SD references remain available through the SD manifest bucket', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tools', 'generated', 'resource-manifest.json'), 'utf8'))
  const direct = Object.entries(manifest.paths.sd).filter(([name]) => name.startsWith('sd'))
  assert.equal(direct.length, 292)
  assert.ok(direct.every(([, target]) => target && !target.includes('transparent.png')))
})

test('asset generation requires an explicit external source', () => {
  assert.throws(() => childProcess.execFileSync('py', ['-3', 'tools/build-runtime-assets.py'], { cwd: projectRoot, stdio: 'pipe' }), /Command failed/)
})

test('RPK size checker accepts an under-limit package and reports build files', () => {
  const { checkRpk, limit } = require('../tools/check-rpk.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanoba-rpk-'))
  const dist = path.join(dir, 'dist')
  const build = path.join(dir, 'build', 'common', 'ev')
  fs.mkdirSync(dist, { recursive: true }); fs.mkdirSync(build, { recursive: true })
  fs.writeFileSync(path.join(dist, 'test.rpk'), Buffer.alloc(limit - 1))
    fs.writeFileSync(path.join(build, 'largest.png'), 'image')
  try {
    const result = checkRpk(dir, { dist, build: path.join(dir, 'build') })
    assert.equal(result.bytes, limit - 1)
    assert.equal(result.categories.ev, 5)
    assert.equal(result.largest[0].name, path.join('build', 'common', 'ev', 'largest.png'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('showDialogue makes the dialogue layer visible', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'detail', 'detail.ux'), 'utf8')
  const method = source.match(/showDialogue\(text\)\s*\{([\s\S]*?)\n\s*\},\n\s*zhuzi\(/)
  assert.ok(method, 'showDialogue method not found')
  assert.match(method[1], /this\.dialogueVisible\s*=\s*true/)
})

test('detail renderer inherits omitted dialogue portraits and uses a static CG', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'detail', 'detail.ux'), 'utf8')
  assert.match(source, /if \(node\.length > 3\) this\.currentCharacters = Array\.isArray\(node\[3\]\) \? node\[3\] : \[\]/)
  assert.match(source, /<image class="cg-image" src="\{\{Img\}\}" if="\{\{Img && isCg\}\}"/)
  assert.doesNotMatch(source, /<scroll id="cg-scroll"/)
  assert.match(source, /自动播放：开/)
})
