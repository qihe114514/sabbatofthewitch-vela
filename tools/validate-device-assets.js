const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
let root = path.join(projectRoot, 'src')
const allowedJson = new Set(['manifest.json', 'manifest-watch.json'])

function filesUnder(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...filesUnder(full))
    else result.push(full)
  }
  return result
}

function exactPath(relative) {
  for (const base of [root, path.join(projectRoot, 'build')]) {
    let current = base
    let found = true
    for (const part of relative.split('/').filter(Boolean)) {
      if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) { found = false; break }
      const actual = fs.readdirSync(current).find(name => name === part)
      if (!actual) { found = false; break }
      current = path.join(current, actual)
    }
    if (found && fs.existsSync(current)) return true
  }
  return false
}

let files
try {
  files = filesUnder(root)
} catch (error) {
  root = path.join(projectRoot, 'build')
  files = filesUnder(root)
}
const badJson = files.filter(file => path.extname(file).toLowerCase() === '.json' && !allowedJson.has(path.basename(file)))
const badImages = files.filter(file => /.(png|jpg|jpeg|webp)$/i.test(file) && path.extname(file) !== '.png')
const missing = new Set()
for (const file of files.filter(file => /.(ux|js|txt|json)$/i.test(file))) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\/common\/[^\s"'<>}`]+/g)) {
    const value = match[0].replace(/[),;]+$/, '')
    if (value.includes('${')) continue
    if (!exactPath(value.slice(1))) missing.add(`${value} (${path.relative(root, file)})`)
  }
}
if (badJson.length) throw new Error(`实体机不支持的 JSON 数据文件：${badJson.map(file => path.relative(root, file)).join(', ')}`)
if (badImages.length) throw new Error(`图片后缀必须为小写 .png：${badImages.map(file => path.relative(root, file)).join(', ')}`)
if (missing.size) throw new Error(`大小写敏感路径不存在：${[...missing].slice(0, 20).join(', ')}`)
console.log(`实体机资源校验通过：${files.length} 个文件，PNG-only，路径大小写匹配`)
