const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', 'src', 'common', 'story')
const index = JSON.parse(fs.readFileSync(path.join(root, 'story-index.txt'), 'utf8'))
let count = 0
for (const chunk of index.chunks) {
  const scenes = JSON.parse(fs.readFileSync(path.join(root, 'chunks', path.basename(chunk.file)), 'utf8'))
  if (!Array.isArray(scenes) || scenes.length !== chunk.count) throw new Error(`章节 ${chunk.file} 的场景数不匹配`)
  for (const scene of scenes) {
    if (!Array.isArray(scene.dialogues) || !scene.dialogues.length) throw new Error(`${chunk.file} 包含没有对白的场景`)
    for (const choice of scene.choices || []) if (!Number.isInteger(choice.nextScene) || choice.nextScene < 0 || choice.nextScene >= index.nodeCount) throw new Error(`${chunk.file} 包含无效选项跳转`)
  }
  count += scenes.length
}
if (count !== index.nodeCount) throw new Error(`索引声明 ${index.nodeCount} 个场景，实际为 ${count}`)
console.log(`故事校验通过：${count} 个场景`)
