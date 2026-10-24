import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,pack,catalog,data} from './helpers.mjs';
import {Campaign,fieldWeather,validatePack,WEATHER_ABILITIES} from '../../game/world.mjs';
import {Random,experience} from '../../game/model.mjs';
test('all three starters start at level 5 with legal abilities, IVs and PP',()=>{
  for(const species of ['TREECKO','TORCHIC','MUDKIP']){
    const c=Campaign.start(catalog,pack,species,1),mon=c.state.party[0];assert.equal(mon.level,5);catalog.validateMon(mon);assert.ok(mon.ivs.some(v=>v>0));assert.ok(mon.moves.length>0);assert.equal(mon.hp,catalog.stats(mon)[0]);
  }
});
test('seeded journeys reproduce encounters without Math.random',()=>{
  const a=fresh(42),b=fresh(42);for(let i=0;i<100;i++)assert.equal(a.random.next(),b.random.next());
  assert.notDeepEqual(fresh(42).state.party[0].ivs,fresh(43).state.party[0].ivs);
});
test('collision, object blocking, warps and indoor weather',()=>{
  const c=fresh();c.state.position={map:'field',x:11,y:9};assert.equal(c.move(0,-1).kind,'blocked');
  c.state.position={map:'field',x:6,y:7};assert.equal(c.move(0,-1).kind,'warp');assert.equal(c.map.id,'lab');assert.deepEqual(c.state.position,{map:'lab',x:12,y:14});
  assert.equal(c.move(0,1).kind,'warp');assert.equal(c.map.id,'field');
  c.state.position={map:'field',x:1,y:1};assert.equal(c.move(-1,0).kind,'blocked');
});
test('all nine weather abilities respect indoors and protected weather',()=>{
  for(const [ability,expected] of Object.entries(WEATHER_ABILITIES)){
    assert.equal(fieldWeather(pack.maps.field,{ability}),expected);
    assert.equal(fieldWeather(pack.maps.lab,{ability}),'clear');assert.equal(fieldWeather(pack.maps.cave,{ability}),'clear');assert.equal(fieldWeather(pack.maps.desert,{ability}),'sand');
  }
  assert.equal(fieldWeather(pack.maps.field,{ability:'Overgrow'}),'clear');
});
test('healing restores HP, status and PP without relocating the player',()=>{
  const c=fresh(),before=structuredClone(c.state.position),m=c.state.party[0];m.hp=1;m.status='poison';m.moves[0].pp=0;c.heal();assert.equal(m.hp,catalog.stats(m)[0]);assert.equal(m.status,null);assert.equal(m.moves[0].pp,catalog.move(m.moves[0].id).pp);assert.deepEqual(c.state.position,before);
});
test('shop requires proximity, enough money, valid quantity and real stock',()=>{
  const c=fresh();c.state.options.difficulty='easy';const shop=c.pack.maps.lab.events.find(e=>e.kind==='shop');assert.throws(()=>c.buy(796,1,shop));c.state.position={map:'lab',x:14,y:10};c.buy(796,1,shop);assert.equal(c.state.inventory[796],1);assert.equal(c.state.money,0);assert.throws(()=>c.buy(1,1,shop));assert.throws(()=>c.buy(1,-1,shop));assert.throws(()=>c.buy(2,1,shop));
});
test('level gain and evolution retain levels, damage and earned identity',()=>{
  const c=fresh(),mon=c.state.party[0],uid=mon.uid;mon.hp--;const damage=catalog.stats(mon)[0]-mon.hp;
  catalog.gainExperience(mon,experience(16,data.species[252].growthRate)-mon.exp);assert.equal(mon.level,16);assert.equal(catalog.stats(mon)[0]-mon.hp,damage);
  c.evolve(uid);assert.equal(mon.species,catalog.id('GROVYLE'));assert.equal(mon.uid,uid);assert.equal(mon.level,16);catalog.validateMon(mon);
});
test('fainted Pokémon remain fainted when gaining levels',()=>{const c=fresh(),m=c.state.party[0];m.hp=0;catalog.gainExperience(m,3000);assert.equal(m.hp,0);});
test('caught Pokémon overflow into storage, with distinct stable identities',()=>{
  const c=fresh();for(let i=0;i<8;i++)c.catchMon(c.createMon('ZIGZAGOON',3));assert.equal(c.state.party.length,6);assert.equal(c.state.boxes.length,3);assert.equal(c.state.caught.filter(x=>x===catalog.id('ZIGZAGOON')).length,1);c.snapshot();
});
test('reject corrupt saves and unsupported content without altering current state',()=>{
  const c=fresh(),before=c.snapshot();for(const edit of [s=>s.party[0].ability='Spicy Spray',s=>s.party[0].hp=999999,s=>s.party[0].moves[0].id=99999,s=>s.position.map='missing',s=>s.party.push(structuredClone(s.party[0])),s=>s.nextId=1,s=>s.money=-1,s=>s.schema=99]){const input=structuredClone(before);edit(input);assert.throws(()=>new Campaign(catalog,pack,input));assert.deepEqual(c.snapshot(),before);}
  const broken=structuredClone(pack);broken.maps.field.events[0].map='missing';assert.throws(()=>validatePack(broken));
});
test('Linking Cord consumes exactly one item and keeps the evolved Pokémon identity',()=>{
  const c=fresh(),mon=c.createMon('KADABRA',16);c.state.party.push(mon);c.state.inventory[796]=2;const uid=mon.uid;
  c.evolve(uid,796);assert.equal(mon.species,catalog.id('ALAKAZAM'));assert.equal(mon.uid,uid);assert.equal(c.state.inventory[796],1);c.snapshot();assert.throws(()=>c.evolve(uid,796));assert.equal(c.state.inventory[796],1);
});
test('storage swaps preserve both identities and party size',()=>{
  const c=fresh();for(let i=0;i<6;i++)c.catchMon(c.createMon('ZIGZAGOON',3));const before=c.state.party[0].uid,stored=c.state.boxes[0].uid;c.swapStorage(0,0);assert.equal(c.state.party[0].uid,stored);assert.equal(c.state.boxes[0].uid,before);assert.equal(c.state.party.length,6);c.snapshot();
});
