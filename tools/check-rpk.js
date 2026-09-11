const fs = require('node:fs')
const path = require('node:path')

const limit = 15000000
const warning = 14000000

function checkRpk(root, options = {}) {
  const dist = options.dist || path.join(root, 'dist')
  const build = options.build || path.join(root, 'build')
  const files = fs.existsSync(dist) ? fs.readdirSync(dist).filter((file) => file.toLowerCase().endsWith('.rpk')) : []
  if (!files.length) throw new Error('dist 中没有 .rpk')
  const file = files.map((name) => ({ name, size: fs.statSync(path.join(dist, name)).size })).sort((a, b) => b.size - a.size)[0]
  const bytes = file.size
  const categories = {}
function category(relative) {
  const parts = relative.split(path.sep)
  const index = parts.indexOf('common')
  return index >= 0 ? parts[index + 1] || 'common' : parts[0] || 'root'
}
function scan(dir, prefix = '') {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) scan(full, path.join(prefix, name))
    else {
      const key = category(path.join(prefix, name))
      categories[key] = (categories[key] || 0) + stat.size
    }
  }
}
  scan(build)
  const largest = []
function largestFiles(dir) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name); const stat = fs.statSync(full)
    if (stat.isDirectory()) largestFiles(full)
    else largest.push({ name: path.relative(root, full), size: stat.size })
  }
}
  largestFiles(build)
  return { file, bytes, categories, largest: largest.sort((a, b) => b.size - a.size).slice(0, 10) }
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..')
  try {
    const result = checkRpk(root)
    console.log(`RPK: ${result.file.name} ${result.bytes} bytes (limit ${limit})`)
    if (result.bytes > warning) console.warn(`RPK 警告：已超过 ${warning} bytes`)
    console.log('分类: ' + Object.entries(result.categories).sort((a, b) => b[1] - a[1]).map(([key, value]) => `${key}=${value}`).join(', '))
    console.log('最大文件: ' + result.largest.map((item) => `${item.name}=${item.size}`).join(', '))
    if (result.bytes > limit) throw new Error(`RPK 超限 ${result.bytes - limit} bytes`)
  } catch (error) {
    console.error(`RPK 检查失败：${error.message}`)
    process.exit(1)
  }
}

module.exports = { checkRpk, limit }
