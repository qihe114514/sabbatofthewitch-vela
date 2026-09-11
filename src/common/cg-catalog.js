import resourceManifest from './resource-manifest.js'

const GROUPS = [
  { id: 'common', title: '共通篇', prefixes: ['0', '6'] },
  { id: 'nene', title: '宁宁篇', prefixes: ['1'] },
  { id: 'meguru', title: '爱瑠篇', prefixes: ['2'] },
  { id: 'tsumugi', title: '䌷篇', prefixes: ['3'] },
  { id: 'akogare', title: '憧子篇', prefixes: ['4'] },
  { id: 'wakana', title: '和奏篇', prefixes: ['5'] }
]

function groupFor(eventId) {
  const first = eventId.charAt(0)
  return GROUPS.find((group) => group.prefixes.indexOf(first) !== -1) || GROUPS[0]
}

export function getCgGroups() {
  const eventPaths = resourceManifest && resourceManifest.paths && resourceManifest.paths.ev ? resourceManifest.paths.ev : {}
  const eventSizes = resourceManifest && resourceManifest.eventSizes ? resourceManifest.eventSizes : {}
  const unique = {}
  Object.keys(eventPaths).forEach((logicalName) => {
    const runtimePath = eventPaths[logicalName]
    const match = String(logicalName || '').match(/^ev(\d{3})/i)
    if (match && runtimePath) {
      const id = `ev${match[1]}`.toLowerCase()
      unique[id] = { src: runtimePath, size: eventSizes[id] || eventSizes[logicalName] || null }
    }
  })

  const groups = GROUPS.map((group) => ({ id: group.id, title: group.title, items: [] }))
  Object.keys(unique).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))).forEach((eventId) => {
    const group = groups.find((item) => item.id === groupFor(eventId.slice(2)).id)
    group.items.push({ id: eventId, title: `CG ${eventId.slice(2)}`, src: unique[eventId].src, size: unique[eventId].size })
  })
  return groups
}

export function getCgGroup(groupId) {
  return getCgGroups().find((group) => group.id === groupId) || null
}

export function getCgItem(groupId, index) {
  const group = getCgGroup(groupId)
  const itemIndex = Number(index)
  return group && Number.isInteger(itemIndex) && group.items[itemIndex] ? group.items[itemIndex] : null
}

export default { getCgGroups, getCgGroup, getCgItem }
