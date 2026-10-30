import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('var WONDER_TRADE_EXCLUDED_SPECIES =');
const end = html.indexOf('async function wonderTradeAtLocation', start);
assert.ok(start >= 0 && end > start, 'Wonder Trade implementation is present');

// Run the real offline Wonder Trade selection functions with a controlled dex.
const createPool = new Function('NAME_DATA', html.slice(start, end) +
  '\nreturn {getWonderTradePool, getWonderTradeMinimumLevels};');

function species(constant, evolutions = [], extras = {}) {
  return {constant, evolutions, baseStats: [50, 50, 50, 50, 50, 50],
    learnableMoves: [1], minimumLevel: 1, ...extras};
}

function fixture() {
  return {species: {
    1: species('RALTS', [{method: 'EVO_LEVEL', parameter: '20', target: 2}]),
    2: species('KIRLIA', [{method: 'EVO_LEVEL', parameter: '30', target: 3}]),
    3: species('GARDEVOIR'),
    4: species('NINCADA', [
      {method: 'EVO_LEVEL', parameter: '20', target: 5},
      {method: 'EVO_SPLIT_FROM_EVO', parameter: 'SPECIES_NINJASK', target: 6}
    ]),
    5: species('NINJASK'),
    6: species('SHEDINJA'),
    7: species('CHARIZARD_MEGA_X', [], {isMega: true, formLabel: 'Mega X'}),
    8: species('PIKACHU', [{method: 'EVO_ITEM', parameter: 'ITEM_THUNDER_STONE', target: 9}]),
    9: species('RAICHU'),
    10: species('GROWLITHE_HISUI', [], {formLabel: 'Hisui'}),
    11: species('PALAFIN_HERO', [], {formLabel: 'Hero'}),
    12: species('BASICAL', [{method: 'EVO_LEVEL', parameter: '20', target: 13}]),
    13: species('MIDAL', [{method: 'EVO_LEVEL', parameter: '20', target: 14}]),
    14: species('FINALAL'),
    15: species('BROKEN', [{method: 'EVO_LEVEL', parameter: 'LEVEL_UNRESOLVED', target: 16}]),
    16: species('BROKEN_EVOLUTION'),
    17: species('CHARIZARD_GMAX', [], {isGmax: true, formLabel: 'Gigantamax'})
  }};
}

test('evolved Pokémon require their real level-up threshold', () => {
  const pool = createPool(fixture());
  assert.ok(pool.getWonderTradePool(8).includes('1'));
  assert.ok(!pool.getWonderTradePool(8).includes('2'));
  assert.ok(!pool.getWonderTradePool(8).includes('3'));
  assert.ok(pool.getWonderTradePool(20).includes('2'));
  assert.ok(!pool.getWonderTradePool(20).includes('3'));
  assert.ok(pool.getWonderTradePool(30).includes('3'));
});

test('split evolutions and two successive level gains are level-legal', () => {
  const pool = createPool(fixture());
  assert.ok(!pool.getWonderTradePool(8).includes('6'));
  assert.ok(pool.getWonderTradePool(20).includes('6'));
  assert.equal(pool.getWonderTradeMinimumLevels()['14'], 21);
});

test('permanent regional and stone forms remain possible; battle-only forms do not', () => {
  const pool = createPool(fixture());
  const at8 = pool.getWonderTradePool(8);
  assert.ok(at8.includes('9')); // Item evolutions can legitimately be early.
  assert.ok(at8.includes('10')); // Regional forms are legal as ordinary Pokémon.
  for (const id of ['7', '11', '17', '16'])
    assert.ok(!at8.includes(id), 'Illegal form or unresolved evolution '+id);
});
