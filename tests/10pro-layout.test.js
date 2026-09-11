const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const detailPath = path.resolve(__dirname, '..', 'src/pages/detail/detail.ux')

test('10Pro rectangular layout keeps the character head inside the viewport', () => {
  const detail = fs.readFileSync(detailPath, 'utf8')
  assert.match(detail, /\.person-single \{[^}]*top: 0px;[^}]*bottom: auto;[^}]*height: 520px/)
  assert.match(detail, /\.person-duo-left \{[^}]*top: 0px;[^}]*bottom: auto;[^}]*height: 490px/)
  assert.match(detail, /\.person-duo-right \{[^}]*top: 0px;[^}]*bottom: auto;[^}]*height: 490px/)
})
