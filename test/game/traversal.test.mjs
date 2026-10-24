import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fresh,catalog,pack} from './helpers.mjs';
import {Campaign} from '../../game/world.mjs';
import {applyFieldEffect,fieldMoveUser,diveConnection} from '../../game/traversal.mjs';
import {runInteractiveScript,runScript} from '../../game/scripts.mjs';
import {encodeSave,decodeSave} from '../../game/storage.mjs';
catalog.scriptData=JSON.parse(fs.readFileSync(new URL('../../game/script-data.json',import.meta.url)));
function coast(){
  const data=structuredClone(pack),m=data.maps.field;for(const other of Object.values(data.maps))other.events=other.events.filter(e=>e.kind!=='warp'||e.map!=='field');m.events=[];m.connections=[];m.tiles=Array.from({length:m.height},()=>'.'.repeat(m.width));m.behaviors=Array.from({length:m.height},()=>Array(m.width).fill('MB_NORMAL'));m.elevations=Array.from({length:m.height},()=>Array(m.width).fill(3));
  for(let y=1;y<10;y++)for(let x=10;x<15;x++){m.tiles[y]=m.tiles[y].slice(0,x)+'~'+m.tiles[y].slice(x+1);m.behaviors[y][x]='MB_OCEAN_WATER';m.elevations[y][x]=1;}
  const state=fresh().snapshot();state.position={map:'field',x:9,y:5};state.vars.VAR_FACING=4;const c=new Campaign(catalog,data,state);return c;
}
test('Surf uses Brisk badge rules and does not require a learned HM or conscious user',()=>{
  const c=coast();assert.equal(fieldMoveUser(catalog,c.state,'FIELD_MOVE_SURF'),-1);assert.equal(c.move(1,0).kind,'blocked');c.state.flags.FLAG_BADGE05_GET=true;c.state.party[0].hp=0;assert.equal(fieldMoveUser(catalog,c.state,'FIELD_MOVE_SURF'),0);applyFieldEffect(c,'FLDEFF_USE_SURF');assert.equal(c.mode,'surf');assert.equal(c.state.position.x,10);assert.equal(c.move(1,0).kind,'step');c.snapshot();
});
test('Surf dismounts at default-elevation shore and cannot climb a raised path',()=>{
  const c=coast();c.state.flags.FLAG_BADGE05_GET=true;applyFieldEffect(c,'FLDEFF_USE_SURF');c.map.elevations[5][9]=4;assert.equal(c.move(-1,0).kind,'blocked');c.map.elevations[5][9]=3;assert.equal(c.move(-1,0).kind,'step');assert.equal(c.mode,'land');assert.equal(c.state.position.x,9);c.snapshot();
});
test('source Surf prompt respects refusal and commits its field effect after acceptance',async()=>{
  const c=coast();c.state.flags.FLAG_BADGE05_GET=true;const before=c.snapshot();await runInteractiveScript(c,pack.sharedScripts,'EventScript_UseSurf',{choose:async()=>0});assert.equal(c.state.position.x,9);assert.equal(c.mode,'land');await runInteractiveScript(c,pack.sharedScripts,'EventScript_UseSurf',{choose:async()=>1});assert.equal(c.state.position.x,10);assert.equal(c.mode,'surf');assert.deepEqual(c.state.party,before.party);
});
test('source field-effect failures roll back movement and earlier story flags',()=>{
  const c=coast(),before=c.snapshot();assert.throws(()=>runScript(c,'Start::\n setflag FLAG_BAD\n dofieldeffect FLDEFF_USE_SURF\n end','Start'),/locked/);assert.deepEqual(c.snapshot(),before);
});
test('ocean map connections select the segment containing the player and preserve Surf',()=>{
  const c=coast();c.state.position={map:'field',x:c.map.width-1,y:6};c.map.tiles[6]=c.map.tiles[6].slice(0,-1)+'~';c.state.field={mode:'surf'};
  const target=structuredClone(c.map);target.id='second';target.height=4;target.tiles=Array(4).fill('~'.repeat(target.width));target.behaviors=Array.from({length:4},()=>Array(target.width).fill('MB_OCEAN_WATER'));target.elevations=Array.from({length:4},()=>Array(target.width).fill(1));target.events=[];target.connections=[];
  const miss=structuredClone(target);miss.id='first';c.pack.maps.first=miss;c.pack.maps.second=target;c.map.connections=[{direction:'right',map:'first',offset:0},{direction:'right',map:'second',offset:4}];assert.equal(c.move(1,0).kind,'warp');assert.deepEqual(c.state.position,{map:'second',x:0,y:2});assert.equal(c.mode,'surf');c.snapshot();
});
test('source map tables restore cave encounters and retain occupied water slots uniformly',()=>{
  const cave=catalog.fieldData.maps.map_granite_cave_1f.encounters.land_mons;assert.equal(cave.rate,5);assert.equal(cave.slots.length,25);assert.ok(cave.slots.every(e=>e.weight===1));const water=catalog.fieldData.maps.map_route103.encounters.water_mons;assert.ok(water.slots.some(e=>!e.species));assert.ok(water.slots.filter(e=>e.species).every(e=>e.weight===1));assert.equal(catalog.fieldData.unresolvedSpecies.length,0);
});
test('cave floor encounters use tile attributes without needing a grass tile',()=>{
  const c=fresh();c.state.position={map:'map_granite_cave_1f',x:0,y:0};const m=c.map;let spot;for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++)if(c.behavior(x,y)==='MB_CAVE'&&c.tile(x,y)!=='#')spot={map:m.id,x,y};assert.ok(spot);c.state.position=spot;c.random.next=()=>0;const result=c.stepEncounter();assert.equal(result.kind,'encounter');assert.ok(catalog.fieldData.maps[m.id].encounters.land_mons.slots.some(e=>e.species===catalog.species(result.mon.species).constant));
});
test('Dive and surface follow source map connections at unchanged coordinates',async()=>{
  const c=fresh();c.state.flags.FLAG_BADGE07_GET=true;c.state.field={mode:'surf'};let spot;
  for(const [id,map]of Object.entries(pack.maps)){if(!map.connections?.some(e=>e.direction==='dive'))continue;for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){c.state.position={map:id,x,y};if(diveConnection(c)&&c.canOccupy(x,y,map,'surf')){spot={map:id,x,y};break;}if(spot)break;}if(spot)break;}
  assert.ok(spot,'No playable dive connection');c.state.position=spot;const dest=diveConnection(c);await runInteractiveScript(c,pack.sharedScripts,'EventScript_UseDive',{choose:async()=>1});assert.deepEqual(c.state.position,{map:dest.map,x:spot.x,y:spot.y});assert.equal(c.mode,'underwater');assert.equal(c.state.vars.VAR_0x8004,0);c.snapshot();
  const saved=await decodeSave(await encodeSave(c.snapshot())),restored=new Campaign(catalog,c.pack,saved);assert.equal(restored.mode,'underwater');assert.deepEqual(restored.state.position,c.state.position);
});
test('Waterfall uses its source gate and cannot be walked up without activating it',async()=>{
  const c=coast();c.state.position={map:'field',x:12,y:8};c.state.field={mode:'surf'};c.state.vars.VAR_FACING=2;for(const y of [6,7])c.map.behaviors[y][12]='MB_WATERFALL';assert.equal(c.move(0,-1).kind,'blocked');assert.throws(()=>applyFieldEffect(c,'FLDEFF_USE_WATERFALL'),/locked/);c.state.flags.FLAG_BADGE08_GET=true;await runInteractiveScript(c,pack.sharedScripts,'EventScript_UseWaterfall',{choose:async()=>1});assert.equal(c.state.position.y,5);assert.equal(c.mode,'surf');c.snapshot();
});
test('fishing requires an owned rod and uses only its source slot group',()=>{
  const c=fresh();c.state.position={map:'map_route103',x:0,y:0};let spot;
  for(let y=0;y<c.map.height;y++)for(let x=0;x<c.map.width-1;x++)if(c.tile(x,y)!=='#'&&c.tile(x,y)!=='~'&&c.tile(x+1,y)==='~')spot={map:c.map.id,x,y};assert.ok(spot);c.state.position=spot;assert.throws(()=>c.fish('old_rod',1,0),/Bag/);const rod=Number(Object.keys(catalog.data.itemDetails).find(id=>catalog.data.itemDetails[id].constant==='ITEM_OLD_ROD'));c.state.inventory[rod]=1;const table=c.mapInfo.encounters.fishing_mons,allowed=table.slots.filter(e=>table.groups.old_rod.includes(e.sourceSlot)).map(e=>e.species);for(let i=0;i<30;i++){const result=c.fish('old_rod',1,0);assert.ok(result.kind==='no_bite'||allowed.includes(catalog.species(result.mon.species).constant));}assert.equal(c.state.inventory[rod],1);
});

test('GBA transfer restores underwater locations added since the original map index',async()=>{
 const {makeGbaSave}=await import('./gba-fixture.mjs'),{importGbaSave,originalGbaBytes}=await import('../../game/gba-import.mjs');const layout=JSON.parse(fs.readFileSync(new URL('../../game/gba-layout.json',import.meta.url))),[key,reference]=Object.entries(layout.maps).find(([,m])=>m.sourceName==='Underwater_Route124');assert.equal(reference.nativeMap,null);const [group,number]=key.split(':').map(Number),map=pack.maps.map_underwater_route124,c=fresh();let point;
 for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)if(c.canOccupy(x,y,map,'underwater')&&c.tile(x,y,map)==='~')point={x,y};assert.ok(point);const bytes=makeGbaSave({location:{group,number,...point}}),{campaign:imported}=await importGbaSave(bytes,catalog,pack,layout);assert.equal(imported.mode,'underwater');assert.deepEqual(imported.state.position,{map:map.id,...point});assert.deepEqual(await originalGbaBytes(imported.state),bytes);imported.snapshot();
});

test('ocean currents enforce source movement direction and stop forcing on calm water',()=>{
 const c=coast();c.state.position={map:'field',x:12,y:5};c.state.field={mode:'surf'};c.map.behaviors[5][12]='MB_EASTWARD_CURRENT';assert.deepEqual(c.forcedDirection(),[1,0]);assert.equal(c.move(-1,0).kind,'step');assert.equal(c.state.position.x,13);assert.equal(c.forcedDirection(),null);assert.equal(c.mode,'surf');c.snapshot();
});
test('Surf and rod interaction reject non-fishable underwater and waterfall tiles',()=>{
 const c=coast();c.state.flags.FLAG_BADGE05_GET=true;c.map.behaviors[5][10]='MB_NO_SURFACING';assert.equal(c.fieldScript(1,0),null);assert.throws(()=>applyFieldEffect(c,'FLDEFF_USE_SURF'),/Cannot Surf/);assert.ok(catalog.fieldData.fishableBehaviors.includes('MB_EASTWARD_CURRENT'));assert.ok(!catalog.fieldData.fishableBehaviors.includes('MB_WATERFALL'));
});
