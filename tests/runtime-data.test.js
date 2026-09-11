const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

function loadRuntimeModule() {
  const source = fs.readFileSync(path.join(root, 'src', 'common', 'runtime-data.js'), 'utf8')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    .concat('\nmodule.exports = { runtimeData, loadRuntimeData, loadSceneAssets }')
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports })
  return module.exports
}

test('runtime startup reads only the scene index', () => {
  const { runtimeData, loadRuntimeData } = loadRuntimeModule()
  const reads = []
  loadRuntimeData((uri, options) => {
    reads.push(uri)
    options.success({ text: JSON.stringify({ common: [{ id: '001', path: '001.txt' }] }) })
  }, (error) => assert.equal(error, undefined))
  assert.deepEqual(reads, ['/common/runtime/scene-index.txt'])
  assert.equal(runtimeData.scenePathById['001'], '001.txt')
})

test('runtime loads and replaces only the requested scene asset descriptor', () => {
  const { runtimeData, loadSceneAssets } = loadRuntimeModule()
  const reads = []
  const descriptor = {
    resourceManifest: { paths: { bg: { school: '/common/bg/school.png' } } },
    characterMap: { '宁宁|01|制服': '/common/sd/nene-body.png' },
    characterFaceMap: { '宁宁|01|制服': '/common/sd/nene-face.png' }
  }
  loadSceneAssets((uri, options) => {
    reads.push(uri)
    options.success({ text: JSON.stringify(descriptor) })
  }, '001', (error) => assert.equal(error, undefined))
  assert.deepEqual(reads, ['/common/runtime/scene-assets/001.txt'])
  assert.deepEqual(JSON.parse(JSON.stringify(runtimeData.resourceManifest)), descriptor.resourceManifest)
  assert.equal(runtimeData.characterMap['宁宁|01|制服'], '/common/sd/nene-body.png')
  assert.equal(runtimeData.sceneAssetId, '001')
})
