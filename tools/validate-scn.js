// 校验「魔女的夜宴」指令流剧本与资源完整性
// 1. 校验 src/common/scn/*.ks.txt 均为合法 JSON 指令流数组
// 2. 校验每个剧本引用的背景(src/common/bg)与SD立绘(src/common/sd)均存在
// 3. 校验剧本节点类型在 SCN_TYPE 合法范围内，LABEL 唯一性
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const scnDir = path.join(root, 'src', 'common', 'scn')
const manifestFile = path.join(root, 'tools', 'generated', 'resource-manifest.json')
const characterMapFile = path.join(root, 'tools', 'generated', 'character-map.generated.json')

const SCN_TYPE_MIN = 0
const SCN_TYPE_MAX = 6

function fail(message) {
  console.error('[校验失败] ' + message)
  process.exitCode = 1
  return false
}

function runtimePathExists(value) {
  if (typeof value !== 'string' || !value.startsWith('/common/')) return false
  const relative = value.slice(1).replace(/\//g, path.sep)
  const source = path.resolve(root, 'src', relative)
  const build = path.resolve(root, 'build', relative)
  return (source.startsWith(path.join(root, 'src', 'common') + path.sep) && fs.existsSync(source)) || (build.startsWith(path.join(root, 'build', 'common') + path.sep) && fs.existsSync(build))
}

function main() {
  if (!fs.existsSync(scnDir)) return fail(`找不到剧本目录 ${scnDir}`)
  const files = fs.readdirSync(scnDir).filter((f) => f.endsWith('.txt')).sort()
  if (files.length === 0) return fail('剧本目录为空')

  let scenes = 0
  let dialogues = 0
  let backgrounds = 0
  let selects = 0
  let evCount = 0
  let missingBg = new Set()
  let missingVisual = new Set()
  let missingCharacter = new Set()
  const duplicateLabels = []
  const seen = new Set()
  let manifest = { paths: {} }
  let characterMap = {}
  try {
    if (fs.existsSync(manifestFile)) manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    if (fs.existsSync(characterMapFile)) characterMap = JSON.parse(fs.readFileSync(characterMapFile, 'utf8'))
  } catch (error) { return fail(`运行时资源 manifest 无法解析: ${error.message}`) }
  const pathFor = (folder, value) => manifest.paths && manifest.paths[folder] && manifest.paths[folder][value]
  const hasPath = (folder, value) => runtimePathExists(pathFor(folder, value))

  for (const file of files) {
    const full = path.join(scnDir, file)
    let data
    try {
      data = JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch (e) {
      fail(`${file} 不是合法 JSON: ${e.message}`)
      continue
    }
    if (!Array.isArray(data)) { fail(`${file} 不是数组`); continue }
    seen.add(file)
    let fileDialogue = 0
    const fileLabels = new Map()
    for (const node of data) {
      if (!Array.isArray(node) || node.length < 2) { fail(`${file} 存在非法节点`); continue }
      const type = node[0]
      if (type < SCN_TYPE_MIN || type > SCN_TYPE_MAX) { fail(`${file} 含未知节点类型 ${type}`); continue }
      switch (type) {
        case 0: fileLabels.set(node[1], (fileLabels.get(node[1]) || 0) + 1); break
        case 1: break
        case 2:
          backgrounds++
          if (node[1] && !hasPath('bg', node[1])) missingBg.add(node[1])
          break
        case 3:
          dialogues++; fileDialogue++
          if (Array.isArray(node[3])) for (const character of node[3]) {
            if (!Array.isArray(character) || !character[0]) continue
            const name = String(character[0])
            if (name.startsWith('sd') || name.startsWith('ev')) {
              if (!hasPath('sd', name) && !hasPath('ev', name)) missingVisual.add(name)
              continue
            }
            const key = `${character[0]}|${character[2] == null ? '' : character[2]}|${character[3] == null ? '' : character[3]}`
            if (!runtimePathExists(characterMap[key] || characterMap[character[0]])) missingCharacter.add(key)
          }
          break
        case 4: selects++; break
        case 5:
          evCount++
          if (node[1] && !hasPath('sd', node[1]) && !hasPath('ev', node[1])) missingVisual.add(node[1])
          break
        case 6: break
      }
    }
    for (const [label, count] of fileLabels.entries()) {
      if (count > 1) duplicateLabels.push(`${file}:${label}`)
    }
    scenes += data.length
    if (fileDialogue === 0) fail(`${file} 没有任何对话行`)
  }

  const uniqueFiles = seen.size

  console.log(`剧本文件: ${uniqueFiles}/${files.length}`)
  console.log(`指令流节点总数: ${scenes}`)
  console.log(`对话: ${dialogues}  背景切换: ${backgrounds}  选项: ${selects}  EV/SD: ${evCount}`)
  if (duplicateLabels.length) console.log(`重复标签: ${duplicateLabels.slice(0, 10).join(', ')}`)
  if (missingBg.size) console.log(`缺失背景: ${[...missingBg].slice(0, 10).join(', ')}`)
  if (missingVisual.size) console.log(`缺失EV/SD: ${[...missingVisual].slice(0, 10).join(', ')}`)
  if (missingCharacter.size) console.log(`缺失角色映射: ${[...missingCharacter].slice(0, 10).join(', ')}`)

  let ok = true
  if (uniqueFiles !== files.length) { fail('存在无法解析的剧本'); ok = false }
  if (duplicateLabels.length) { fail(`存在重复标签 ${duplicateLabels.length} 个`); ok = false }
  if (missingBg.size) { fail(`缺失 ${missingBg.size} 张背景`); ok = false }
  if (missingVisual.size) { fail(`缺失 ${missingVisual.size} 个EV/SD资源`); ok = false }
  if (missingCharacter.size) { fail(`缺失 ${missingCharacter.size} 个角色映射`); ok = false }
  if (!ok) return

  console.log('剧本与资源校验通过')
}

main()
