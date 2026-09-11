export const runtimeData = {
  characterMap: {},
  characterFaceMap: {},
  resourceManifest: { paths: {} },
  sceneList: {},
  scenePathById: {},
  sceneAssetId: '',
  loaded: false,
}

let loading = false
let waiters = []

export function clearSceneAssets() {
  runtimeData.characterMap = {}
  runtimeData.characterFaceMap = {}
  runtimeData.resourceManifest = { paths: {} }
  runtimeData.sceneAssetId = ''
}

export function loadRuntimeData(readText, done) {
  if (runtimeData.loaded) return done()
  waiters.push(done)
  if (loading) return
  loading = true
  readText('/common/runtime/scene-index.txt', {
    success: (data) => {
      let error
      try {
        runtimeData.sceneList = JSON.parse(data.text)
        const index = {}
        Object.keys(runtimeData.sceneList).forEach((category) => {
          const scenes = runtimeData.sceneList[category] || []
          scenes.forEach((scene) => { if (scene && scene.id) index[scene.id] = scene.path })
        })
        runtimeData.scenePathById = index
        runtimeData.loaded = true
      } catch (caught) { error = caught }
      loading = false
      const callbacks = waiters
      waiters = []
      callbacks.forEach((callback) => callback(error))
    },
    fail: () => {
      loading = false
      const callbacks = waiters
      waiters = []
      callbacks.forEach((callback) => callback(new Error('runtime data read failed: /common/runtime/scene-index.txt')))
    },
  })
}

export function loadSceneAssets(readText, id, done) {
  const sceneId = String(id || '')
  if (!sceneId) return done(new Error('scene asset id is required'))
  if (runtimeData.sceneAssetId === sceneId) return done()
  clearSceneAssets()
  readText(`/common/runtime/scene-assets/${sceneId}.txt`, {
    success: (data) => {
      try {
        const parsed = JSON.parse(data.text)
        runtimeData.characterMap = parsed.characterMap || {}
        runtimeData.characterFaceMap = parsed.characterFaceMap || {}
        runtimeData.resourceManifest = parsed.resourceManifest && parsed.resourceManifest.paths ? parsed.resourceManifest : { paths: {} }
        runtimeData.sceneAssetId = sceneId
        done()
      } catch (error) { done(error) }
    },
    fail: () => done(new Error(`scene assets read failed: ${sceneId}`)),
  })
}
