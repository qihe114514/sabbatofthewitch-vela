const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const common = path.join(root, 'src', 'common')
const runtime = path.join(common, 'runtime')
const output = path.join(runtime, 'scene-assets')
const generated = path.join(root, 'tools', 'generated')

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function addPath(paths, folder, name, manifest) {
  if (!name) return
  const target = (manifest.paths[folder] || {})[name]
  if (target) paths[folder][name] = target
}

function addVisual(paths, value, manifest) {
  if (!value) return
  const name = String(value)
  if (name.startsWith('sd')) return addPath(paths, 'sd', name, manifest)
  if (name.startsWith('ch_')) return addPath(paths, 'overlay', name, manifest)
  addPath(paths, 'ev', name, manifest)
}

function descriptorFor(script, manifest, characterMap, characterFaceMap) {
  const paths = { bg: {}, sd: {}, ev: {}, overlay: {} }
  const bodies = {}
  const faces = {}
  for (const node of script) {
    if (!Array.isArray(node)) continue
    if (node[0] === 2) addPath(paths, 'bg', node[1], manifest)
    if (node[0] === 5) addVisual(paths, node[1], manifest)
    if (node[0] !== 3 || !Array.isArray(node[3])) continue
    for (const entry of node[3]) {
      if (!Array.isArray(entry) || !entry[0]) continue
      const key = `${entry[0]}|${entry[2] || ''}|${entry[3] || ''}`
      if (characterMap[key]) bodies[key] = characterMap[key]
      if (characterFaceMap[key]) faces[key] = characterFaceMap[key]
    }
  }
  return { resourceManifest: { paths }, characterMap: bodies, characterFaceMap: faces }
}

function generateSceneAssets() {
  const scenes = readJson(path.join(runtime, 'scene-index.txt'))
  const manifest = readJson(path.join(generated, 'resource-manifest.json'))
  const characterMap = readJson(path.join(generated, 'character-map.generated.json'))
  const characterFaceMap = readJson(path.join(generated, 'character-face-map.generated.json'))
  const entries = Object.values(scenes).flat()
  fs.rmSync(output, { recursive: true, force: true })
  fs.mkdirSync(output, { recursive: true })
  for (const scene of entries) {
    const script = readJson(path.join(common, 'scn', scene.path))
    fs.writeFileSync(path.join(output, `${scene.id}.txt`), JSON.stringify(descriptorFor(script, manifest, characterMap, characterFaceMap)))
  }
  for (const file of ['resource-manifest.txt', 'character-map.txt', 'character-face-map.txt']) fs.rmSync(path.join(runtime, file), { force: true })
  console.log(`场景资源描述已生成：${entries.length}`)
}

if (require.main === module) generateSceneAssets()

module.exports = { descriptorFor, generateSceneAssets }
