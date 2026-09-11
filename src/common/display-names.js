const DISPLAY_NAMES = {
  '寧々': '宁宁',
  'めぐる': '爱瑠',
  '紬': '䌷',
  '䌷': '䌷',
  '七緒': '七绪',
  'アカギ': '赤城'
}

export function toDisplayCharacterName(name) {
  const key = String(name || '')
  return Object.prototype.hasOwnProperty.call(DISPLAY_NAMES, key) ? DISPLAY_NAMES[key] : key
}

export default { toDisplayCharacterName }
