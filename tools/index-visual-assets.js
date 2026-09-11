const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const scnRoot = path.join(projectRoot, 'src', 'common', 'scn')
const assetRoots = {
  bg: path.join(projectRoot, 'src', 'common', 'bg'),
  sd: path.join(projectRoot, 'src', 'common', 'sd'),
  ev: path.join(projectRoot, 'src', 'common', 'ev'),
  overlay: path.join(projectRoot, 'src', 'common', 'overlay')
}
const imageExtensions = ['.png']

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function listBasenames(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((file) => imageExtensions.includes(path.extname(file).toLowerCase())).map((file) => path.basename(file, path.extname(file)))
}

function listAssetPaths(type, dir) {
  if (!fs.existsSync(dir)) return {}
  return Object.fromEntries(fs.readdirSync(dir)
    .filter((file) => imageExtensions.includes(path.extname(file).toLowerCase()))
    .map((file) => [path.basename(file, path.extname(file)), `/common/${type}/${file}`]))
}

function readPngSize(file) {
  try {
    const data = fs.readFileSync(file)
    if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString('ascii', 12, 16) === 'IHDR') {
      return [data.readUInt32BE(16), data.readUInt32BE(20)]
    }
  } catch (error) {}
  return null
}

function largestPath(type, prefix) {
  const root = assetRoots[type]
  if (!fs.existsSync(root)) return ''
  const candidates = fs.readdirSync(root)
    .filter((file) => file.startsWith(prefix) && imageExtensions.includes(path.extname(file).toLowerCase()))
    .map((file) => ({ file, size: fs.statSync(path.join(root, file)).size }))
    .sort((left, right) => right.size - left.size || left.file.localeCompare(right.file))
  return candidates.length ? `/common/${type}/${candidates[0].file}` : ''
}

function readCharacterMap() {
  const file = path.join(projectRoot, 'tools', 'generated', 'character-map.generated.json')
  return fs.existsSync(file) ? readJson(file) : {}
}

function readRuntimeManifest() {
  const file = path.join(projectRoot, 'tools', 'generated', 'resource-manifest.json')
  return fs.existsSync(file) ? readJson(file) : null
}

function runtimePathExists(value) {
  if (typeof value !== 'string' || !value.startsWith('/common/')) return false
  const relative = value.slice(1).replace(/\//g, path.sep)
  const source = path.resolve(projectRoot, 'src', relative)
  const build = path.resolve(projectRoot, 'build', relative)
  return (source.startsWith(path.resolve(projectRoot, 'src', 'common') + path.sep) && fs.existsSync(source)) || (build.startsWith(path.resolve(projectRoot, 'build', 'common') + path.sep) && fs.existsSync(build))
}

function addRef(refs, type, logicalName, source, extra = {}) {
  if (!logicalName) return
  const key = `${type}:${logicalName}`
  if (!refs.has(key)) refs.set(key, { type, logicalName, sources: [], ...extra })
  const item = refs.get(key)
  if (!item.sources.includes(source)) item.sources.push(source)
}

function collectRefs() {
  const refs = new Map()
  const files = fs.readdirSync(scnRoot).filter((file) => file.endsWith('.txt')).sort()
  for (const file of files) {
    const data = readJson(path.join(scnRoot, file))
    for (let index = 0; index < data.length; index += 1) {
      const node = data[index]
      if (!Array.isArray(node)) continue
      const type = Number(node[0])
      if (type === 2) addRef(refs, 'bg', node[1], `${file}:${index + 1}`)
      if (type === 5) addRef(refs, String(node[1] || '').startsWith('sd') ? 'sd' : 'ev', node[1], `${file}:${index + 1}`)
      if (type === 3 && Array.isArray(node[3])) {
        for (const character of node[3]) {
          if (!Array.isArray(character) || !character[0]) continue
          const name = String(character[0])
          const expression = character[2] == null ? '' : String(character[2])
          const costume = character[3] == null ? '' : String(character[3])
          const directType = name.startsWith('sd') ? 'sd' : name.startsWith('ev') ? 'ev' : name.startsWith('/common/bg/') ? 'bg' : name.startsWith('/common/ev/') ? 'ev' : name.startsWith('/common/sd/') ? 'sd' : 'character'
          const logicalName = directType === 'character' ? `${name}|${expression}|${costume}` : path.basename(name).replace(/\.(jpg|jpeg|png|webp)$/i, '')
          addRef(refs, directType, logicalName, `${file}:${index + 1}`, { character: name, expression, costume })
        }
      }
    }
  }
  return { files, refs: [...refs.values()] }
}

function resolveCandidates(item) {
  if (item.type === 'character') return []
  const root = assetRoots[item.type]
  const names = listBasenames(root)
  return names.filter((name) => name === item.logicalName)
}

function buildIndex() {
  const { files, refs } = collectRefs()
  const runtime = readRuntimeManifest()
  const paths = runtime && runtime.paths
    ? Object.fromEntries(Object.keys(assetRoots).map((type) => [type, { ...(runtime.paths[type] || {}) }]))
    : Object.fromEntries(Object.entries(assetRoots).map(([type, dir]) => [type, listAssetPaths(type, dir)]))
  const assets = Object.fromEntries(Object.keys(assetRoots).map((type) => [type, Object.keys(paths[type] || {})]))
  const characterMap = readCharacterMap()
  const eventSizes = {}
  for (const file of fs.existsSync(assetRoots.ev) ? fs.readdirSync(assetRoots.ev) : []) {
    if (!imageExtensions.includes(path.extname(file).toLowerCase())) continue
    const size = readPngSize(path.join(assetRoots.ev, file))
    if (size) eventSizes[path.basename(file, path.extname(file))] = size
  }
  for (const item of refs) {
    if (item.type !== 'ev' || paths.ev[item.logicalName]) continue
    const value = item.logicalName
    const eventBase = /^ev\d+/i.exec(value)
    const eventPath = eventBase && largestPath('ev', `${eventBase[0]}a__`)
    const staticPath = paths.bg[value] || paths.sd[value] || paths.overlay[value]
    if (eventPath || staticPath) paths.ev[value] = eventPath || staticPath
  }
  const entries = refs.map((item) => {
    const matches = resolveCandidates(item)
    const mapped = item.type === 'character' && runtimePathExists(characterMap[item.logicalName])
    const alias = item.type === 'bg'
      ? runtimePathExists(paths.bg[item.logicalName])
      : item.type === 'ev'
      ? runtimePathExists(paths.ev[item.logicalName])
      : item.type === 'sd' && (runtimePathExists(paths.sd[item.logicalName]) || runtimePathExists(paths.ev[item.logicalName]))
    return { ...item, matches, status: mapped || alias || (!runtime && matches.length) ? 'available' : item.type === 'character' ? 'unmapped' : 'missing' }
  })
  const counts = {}
  for (const entry of entries) counts[entry.status] = (counts[entry.status] || 0) + 1
  return {
    generatedAt: new Date().toISOString(),
    source: { scenarioDirectory: 'src/common/scn', files },
    assets,
    paths,
    eventSizes,
    counts,
    references: entries
  }
}

function writeReports(index) {
  const docs = path.join(projectRoot, 'docs')
  fs.mkdirSync(docs, { recursive: true })
  fs.writeFileSync(path.join(docs, '资源索引.json'), `${JSON.stringify(index, null, 2)}\n`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'common', 'resource-manifest.js'), `// Generated by npm run index:visual.\nexport default ${JSON.stringify({ paths: index.paths, eventSizes: index.eventSizes }, null, 2)}\n`)
  const missing = index.references.filter((item) => item.status !== 'available')
  const lines = [
    '# 视觉资源索引与缺口',
    '',
    `生成时间：${index.generatedAt}`,
    '',
    `剧本文件：${index.source.files.length}`, 
    `引用总数：${index.references.length}`,
    `可用：${index.counts.available || 0}，缺失：${index.counts.missing || 0}，角色未映射：${index.counts.unmapped || 0}`,
    '',
    '## 缺口',
    ''
  ]
  if (!missing.length) lines.push('没有缺失或未映射的视觉资源。')
  else for (const item of missing) lines.push(`- [${item.status}] ${item.type}: ${item.logicalName}（${item.sources.slice(0, 3).join(', ')}）`)
  lines.push('', '资源目录：`src/common/bg`、`src/common/sd`、`src/common/ev`、`src/common/overlay`。')
  fs.writeFileSync(path.join(docs, '资源缺口.md'), `${lines.join('\n')}\n`)
}

if (require.main === module) {
  const index = buildIndex()
  writeReports(index)
  console.log(`视觉资源索引已生成：${index.references.length} 个引用，缺口 ${index.references.filter((item) => item.status !== 'available').length} 个`)
}

module.exports = { buildIndex, collectRefs, runtimePathExists }
