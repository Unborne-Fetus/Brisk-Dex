import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,catalog} from './helpers.mjs';
import {LocalBattle,effectiveness} from '../../game/battle.mjs';
test('type chart handles immunity, dual weakness and resistance',()=>{assert.equal(effectiveness('Normal',['Ghost']),0);assert.equal(effectiveness('Ice',['Dragon','Flying']),4);assert.equal(effectiveness('Fire',['Water','Dragon']),.25);});
test('local combat spends PP, applies damage and finishes without a phantom enemy',()=>{
  const c=fresh(),battle=new LocalBattle(c,c.createMon('ZIGZAGOON',3)),pp=battle.player.moves[0].pp;
  battle.act({type:'move',index:0});assert.equal(battle.player.moves[0].pp,pp-1);assert.ok(battle.enemy.hp<catalog.stats(battle.enemy)[0]||battle.player.hp<catalog.stats(battle.player)[0]);
  for(let i=0;i<100&&battle.phase==='battle';i++){const choices=battle.available(battle.player);battle.act({type:'move',index:choices[0]??-1});}
  assert.ok(['won','lost'].includes(battle.phase));assert.throws(()=>battle.act({type:'move',index:0}));c.snapshot();
});
test('catching spends a ball and preserves opponent HP and identity',()=>{
  const c=fresh(),battle=new LocalBattle(c,c.createMon('ZIGZAGOON',3));battle.random.next=()=>0;
  const uid=battle.enemy.uid;const hp=battle.enemy.hp;battle.act({type:'catch'});assert.equal(battle.phase,'caught');assert.equal(c.state.inventory[1],9);assert.equal(c.state.party[1].uid,uid);assert.equal(c.state.party[1].hp,hp);c.snapshot();
});
test('trainer Pokémon cannot be caught and trainer battles cannot be escaped',()=>{
  const c=fresh(),b=new LocalBattle(c,c.createMon('ZIGZAGOON',3),{trainer:'Rival'});assert.throws(()=>b.act({type:'catch'}));assert.throws(()=>b.act({type:'run'}));assert.equal(c.state.inventory[1],10);
});
test('reject unavailable PP, unsupported actions and no healthy party',()=>{
  const c=fresh(),b=new LocalBattle(c,c.createMon('ZIGZAGOON',3));b.player.moves[0].pp=0;assert.throws(()=>b.act({type:'move',index:0}));assert.throws(()=>b.act({type:'move',index:9}));assert.throws(()=>b.act({type:'switch',index:0}));assert.throws(()=>b.act({type:'fake'}));c.state.party[0].hp=0;assert.throws(()=>new LocalBattle(c,c.createMon('ZIGZAGOON',3)));
});
test('deterministic battle replays produce the same save and battle log',()=>{
  const run=()=>{const c=fresh(123),b=new LocalBattle(c,c.createMon('ZIGZAGOON',3));for(let i=0;i<5&&b.phase==='battle';i++)b.act({type:'move',index:0});return {save:c.snapshot(),log:b.log};};assert.deepEqual(run(),run());
});
