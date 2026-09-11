export const runtimeData = {
  characterMap: {},
  characterFaceMap: {},
  resourceManifest: { paths: {} },
  sceneList: {},
  scenePathById: {},
  loaded: false,
}

let loading = false
let waiters = []

export function loadRuntimeData(readText, done) {
  if (runtimeData.loaded) return done()
  waiters.push(done)
  if (loading) return
  loading = true
  const files = [
    ['/common/runtime/character-map.txt', 'characterMap'],
    ['/common/runtime/character-face-map.txt', 'characterFaceMap'],
    ['/common/runtime/resource-manifest.txt', 'resourceManifest'],
    ['/common/runtime/scene-index.txt', 'sceneList'],
  ]
  const finish = (error) => {
    loading = false
    if (!error) runtimeData.loaded = true
    const callbacks = waiters
    waiters = []
    callbacks.forEach((callback) => callback(error))
  }
  const read = (index) => {
    if (index >= files.length) return finish()
    const [uri, key] = files[index]
    readText(uri, {
      success: (data) => {
        try {
          runtimeData[key] = JSON.parse(data.text)
          if (key === 'sceneList') {
            const index = {}
            Object.keys(runtimeData.sceneList).forEach((category) => {
              const scenes = runtimeData.sceneList[category] || []
              scenes.forEach((scene) => { if (scene && scene.id) index[scene.id] = scene.path })
            })
            runtimeData.scenePathById = index
          }
          read(index + 1)
        } catch (error) {
          finish(error)
        }
      },
      fail: () => finish(new Error(`runtime data read failed: ${uri}`)),
    })
  }
  read(0)
}
