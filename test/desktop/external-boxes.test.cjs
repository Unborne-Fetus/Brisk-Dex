'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const helpers = html.match(/var externalStorage = \[\];[\s\S]*?var dirty = false;/);
assert.ok(helpers, 'external box helpers must be present');
const scope = vm.createContext({});
vm.runInContext(helpers[0], scope);

test('legacy external archives are divided into 30-slot boxes with no data loss', () => {
  const records = Array.from({length: 67}, (_, i) => ({id: String(i), raw80: 'raw-record-' + i}));
  const migrated = scope.normalizeExternalBoxes(records);
  assert.equal(migrated.length, 67);
  assert.deepEqual(Array.from(migrated, row => row.boxIndex).slice(0, 32),
    Array.from({length: 32}, (_, i) => i < 30 ? 0 : 1));
  assert.equal(migrated[59].boxIndex, 1);
  assert.equal(migrated[60].boxIndex, 2);
  assert.equal(migrated[66].boxIndex, 2);
  assert.equal(migrated[66].raw80, records[66].raw80);
  assert.equal(records[66].boxIndex, undefined, 'normalization must not overwrite imported backup data');
});

test('explicit high box numbers are preserved and full boxes spill to next box', () => {
  const records = Array.from({length: 32}, (_, i) => ({id: String(i), boxIndex: 20000}));
  const migrated = scope.normalizeExternalBoxes(records);
  assert.equal(migrated[29].boxIndex, 20000);
  assert.equal(migrated[30].boxIndex, 20001);
  assert.equal(migrated[31].boxIndex, 20001);
  scope.externalStorage = migrated;
  assert.equal(scope.externalBoxOccupancy(20000), 30);
  assert.equal(scope.externalBoxOccupancy(20001), 2);
});

test('external boxes have navigation and re-assignment controls', () => {
  for(const id of ['btn-storage-prev-box','btn-storage-next-box','btn-storage-jump-box','storage-box-label']){
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /text:'Move to another box'/);
});
