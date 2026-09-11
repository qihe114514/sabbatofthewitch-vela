let resourceManifest = { paths: {} }
const DEFAULT_EXTENSION = '.png'

export function setResourceManifest(value) {
  resourceManifest = value && value.paths ? value : { paths: {} }
}

function cleanName(value) {
  return String(value || '').replace(/^\/+/, '').replace(/\.(jpg|jpeg|png|webp)$/i, '')
}

function assetPath(folder, value, extension = DEFAULT_EXTENSION) {
  if (!value) return ''
  const name = String(value)
  if (name.startsWith('/')) return name
  const known = resourceManifest && resourceManifest.paths && resourceManifest.paths[folder]
  const knownPath = known && known[cleanName(name)]
  if (known) return knownPath || ''
  return `/common/${folder}/${cleanName(name)}${extension}`
}

function knownPath(value) {
  const name = cleanName(value)
  const paths = resourceManifest && resourceManifest.paths
  if (!paths) return ''
  for (const folder of ['ev', 'sd', 'overlay', 'bg']) {
    if (paths[folder] && paths[folder][name]) return paths[folder][name]
  }
  return ''
}

function mappedPath(value) {
  if (!value) return ''
  const name = String(value)
  if (name.startsWith('/')) return name
  if (name.startsWith('common/')) return `/${name}`
  return `/common/${name}`
}

export function resolveBackground(value) {
  return assetPath('bg', value)
}

export function resolveEvent(value) {
  if (!value) return ''
  const name = String(value)
  if (name.startsWith('/')) return name
  if (name.startsWith('sd')) return assetPath('sd', name) || knownPath(name)
  return knownPath(name) || (name.startsWith('sd') ? assetPath('sd', name) : name.startsWith('ev') ? assetPath('ev', name) : name.startsWith('ch_') ? assetPath('overlay', name) : '')
}

export function resolveCharacter(character, expression, costume, mapping = {}) {
  if (!character) return ''
  const name = String(character)
  if (name.startsWith('/')) return name
  if (name.startsWith('sd')) return assetPath('sd', name)
  if (name.startsWith('ev')) return assetPath('ev', name)
  const key = `${name}|${expression == null ? '' : expression}|${costume == null ? '' : costume}`
  // Character assets are keyed by the complete script tuple. Falling back to
  // a name-only asset can silently show the wrong costume or expression.
  const mapped = mapping[key]
  return mappedPath(mapped && typeof mapped === 'object' ? mapped.body : mapped)
}

export function resolveCharacterLayers(character, expression, costume, bodyMapping = {}, faceMapping = {}) {
  const body = resolveCharacter(character, expression, costume, bodyMapping)
  if (!body) return null
  if (!character || String(character).startsWith('/')) return { body, face: '' }
  const name = String(character)
  const key = `${name}|${expression == null ? '' : expression}|${costume == null ? '' : costume}`
  const mappedFace = faceMapping[key]
  return { body, face: mappedPath(mappedFace) }
}

export default { resolveBackground, resolveEvent, resolveCharacter, resolveCharacterLayers }
