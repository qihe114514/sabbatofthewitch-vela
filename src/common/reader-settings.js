export const DEFAULT_READER_SETTINGS = {
  textSpeed: 25,
  textSize: 22,
  autoPlay: false,
  autoPlaySpeed: 'medium'
}

const AUTO_PLAY_SPEEDS = { slow: 1.35, medium: 1, fast: 0.7 }

export function normalizeReaderSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const textSpeed = Number(value.textSpeed)
  const textSize = Number(value.textSize)
  const autoPlaySpeed = Object.prototype.hasOwnProperty.call(AUTO_PLAY_SPEEDS, value.autoPlaySpeed) ? value.autoPlaySpeed : DEFAULT_READER_SETTINGS.autoPlaySpeed
  return Object.assign({}, DEFAULT_READER_SETTINGS, value, {
    textSpeed: Number.isFinite(textSpeed) ? textSpeed : DEFAULT_READER_SETTINGS.textSpeed,
    textSize: Number.isFinite(textSize) ? textSize : DEFAULT_READER_SETTINGS.textSize,
    autoPlay: Boolean(value.autoPlay),
    autoPlaySpeed
  })
}

export function getAutoAdvanceDelay(text, speed = DEFAULT_READER_SETTINGS.autoPlaySpeed) {
  const length = String(text || '').replace(/\s/g, '').length
  const multiplier = AUTO_PLAY_SPEEDS[speed] || AUTO_PLAY_SPEEDS.medium
  return Math.max(1400, Math.min(9000, Math.round((1100 + length * 65) * multiplier)))
}

export default { DEFAULT_READER_SETTINGS, normalizeReaderSettings, getAutoAdvanceDelay }
