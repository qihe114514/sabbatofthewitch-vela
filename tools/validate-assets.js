const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', 'src')
const story = path.join(root, 'common', 'story')
const index = JSON.parse(fs.readFileSync(path.join(story, 'story-index.txt'), 'utf8'))
const refs = new Set(['/common/images/icon.png'])
for (const chunk of index.chunks) for (const scene of JSON.parse(fs.readFileSync(path.join(story, 'chunks', path.basename(chunk.file)), 'utf8'))) {
  if (scene.background) refs.add(scene.background)
  if (scene.cgImage && scene.cgImage.image) refs.add(scene.cgImage.image)
  for (const character of scene.characters || []) if (character.image) refs.add(character.image)
  for (const overlay of [scene.sceneOverlay, scene.centerOverlay, scene.topRightOverlay]) if (overlay && overlay.image) refs.add(overlay.image)
}
for (const ref of refs) if (!fs.existsSync(path.join(root, ref.slice(1)))) throw new Error(`缺少资源：${ref}`)
console.log(`资源校验通过：${refs.size} 个文件`)
