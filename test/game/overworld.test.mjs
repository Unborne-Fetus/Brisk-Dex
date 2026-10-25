import {test} from 'node:test';import assert from 'node:assert/strict';
import {fresh} from './helpers.mjs';import {refreshWildlife,meetWildlife} from '../../game/overworld.mjs';
function field(){const c=fresh();c.state.options.overworldEncounters=true;c.state.position={map:'map_route101',x:15,y:10};return c;}
test('density, fast hunting expiry, disabling wildlife and map transitions preserve valid state',()=>{
 const c=field();c.state.options.wildlifeDensity=9;refreshWildlife(c);assert.equal(c.state.wildlife.actors.length,9);const old=new Set(c.state.wildlife.actors.map(a=>a.mon.uid));c.state.options.shinyHunt=true;c.state.steps+=9;refreshWildlife(c);assert.ok(c.state.wildlife.actors.every(a=>!old.has(a.mon.uid)));c.snapshot();
 c.state.options.wildlifeDensity=3;refreshWildlife(c);assert.equal(c.state.wildlife.actors.length,3);c.state.options.overworldEncounters=false;refreshWildlife(c);assert.equal(c.state.wildlife.actors.length,0);
 c.state.options.overworldEncounters=true;c.state.position={map:'map_route103',x:10,y:8};refreshWildlife(c);assert.equal(c.state.wildlife.map,'map_route103');c.snapshot();
});
test('touching a visible Pokémon starts exactly that encounter and removes it only once',()=>{
 const c=field();refreshWildlife(c);const a=c.state.wildlife.actors[0],mon=structuredClone(a.mon);assert.deepEqual(meetWildlife(c,a.x,a.y),{kind:'encounter',mon});assert.equal(meetWildlife(c,a.x,a.y),null);c.snapshot();
});
test('wildlife remains on matching encounter terrain, avoids NPCs and player, and never duplicates identity',()=>{
 const c=field();for(let i=0;i<100;i++){c.state.steps++;refreshWildlife(c);const cells=new Set(),ids=new Set();for(const a of c.state.wildlife.actors){assert.ok(!cells.has(`${a.x},${a.y}`));cells.add(`${a.x},${a.y}`);assert.ok(!ids.has(a.mon.uid));ids.add(a.mon.uid);assert.ok(c.catalog.fieldData.tileAttributes[c.behavior(a.x,a.y)].encounters);assert.ok(!c.visibleEvents().some(e=>e.x===a.x&&e.y===a.y));assert.ok(a.x!==c.state.position.x||a.y!==c.state.position.y);assert.ok(['approach','flee','wander'].includes(a.temperament));}c.snapshot();}
});
