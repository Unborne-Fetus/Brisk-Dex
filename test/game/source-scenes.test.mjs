import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fresh,pack,catalog} from './helpers.mjs';
import {Campaign} from '../../game/world.mjs';
import {LocalBattle} from '../../game/battle.mjs';
import {runInteractiveScript,runScript} from '../../game/scripts.mjs';
import {mapEntryScripts,coordinateScript,frameScript} from '../../game/scenes.mjs';
import {setMetatile} from '../../game/field-specials.mjs';
catalog.scriptData=JSON.parse(fs.readFileSync(new URL('../../game/script-data.json',import.meta.url)));
function position(c,map){const y=map.tiles.findIndex(row=>row.includes('.'));c.state.position={map:map.id,x:map.tiles[y].indexOf('.'),y};}
const trainerNames=['ROXANNE','BRAWLY','WATTSON','FLANNERY','WINONA','TATE_AND_LIZA','JUAN'];
for(const name of trainerNames)test(`source ${name} victory executes its actual badge script`,async()=>{
  const c=fresh(),map=Object.values(pack.maps).find(m=>m.events.some(e=>e.id===`TRAINER_${name}_1`)),event=map.events.find(e=>e.id===`TRAINER_${name}_1`);position(c,map);let battles=0;
  await runInteractiveScript(c,pack.sharedScripts+'\n'+map.scriptText,event.sourceScript,{choose:async request=>{if(request.kind==='battle'){battles++;assert.equal(request.trainer,event.id);assert.deepEqual(request.team.party,catalog.scriptData.trainers[event.id].party);return {phase:'won',state:request.state};}return 1;}});
  assert.equal(battles,1);const badge={ROXANNE:1,BRAWLY:2,WATTSON:3,FLANNERY:4,WINONA:6,TATE_AND_LIZA:7,JUAN:8}[name];assert.equal(c.state.flags[`FLAG_BADGE0${badge}_GET`],true);assert.equal(c.state.flags[event.id],true);c.snapshot();
});
test('source Norman victory unlocks the gym doors and awards the Balance Badge',async()=>{
  const c=fresh(),map=pack.maps.map_petalburg_city_gym;position(c,map);await runInteractiveScript(c,pack.sharedScripts+'\n'+map.scriptText,'PetalburgCity_Gym_EventScript_NormanBattle',{choose:async r=>r.kind==='battle'?{phase:'won',state:r.state}:1});assert.equal(c.state.flags.FLAG_BADGE05_GET,true);assert.ok(Object.keys(c.state.metatiles[map.id]).length>0);c.snapshot();
});
test('ordered scene dialogue does not replay after battle or subsequent prompts',async()=>{
  const c=fresh(),sequence=[],source='Start::\n msgbox Intro, MSGBOX_DEFAULT\n trainerbattle_single TRAINER_CALVIN_1, Intro, Defeat\n giveitem ITEM_POTION\n msgbox After, MSGBOX_DEFAULT\n end\nIntro:\n .string "Ready?$"\nDefeat:\n .string "You win!$"\nAfter:\n .string "Thank you.$"';
  await runInteractiveScript(c,source,'Start',{present:true,choose:async r=>{sequence.push(r.kind==='battle'?'battle':r.message);return r.kind==='battle'?{phase:'won',state:r.state}:0;}});assert.deepEqual(sequence,['Ready?','battle','You win!','Thank you.']);assert.equal(c.state.inventory[28],6);
});
test('losing or cancelling a scripted battle cannot grant its victory badge',async()=>{
  for(const result of [null,'lost']){const c=fresh(),before=c.snapshot();await assert.rejects(()=>runInteractiveScript(c,'Start::\n trainerbattle_single TRAINER_CALVIN_1, Intro, Intro\n setflag FLAG_BADGE01_GET\n end\nIntro:\n .string "Battle!$"','Start',{choose:async r=>result===null?null:{phase:'lost',state:r.state}}));assert.deepEqual(c.snapshot(),before);}
});
test('local doubles wait for both commands and resolve an actual victory',()=>{
  const c=fresh();c.state.party=[c.createMon('CHARIZARD',90),c.createMon('BLASTOISE',90)];const b=new LocalBattle(c,[c.createMon('ZIGZAGOON',3),c.createMon('POOCHYENA',3)],{trainer:'Double Trainer',format:'doubles'}),turn=b.turn;
  function command(){const choices=b.available(b.player);const index=choices.sort((a,z)=>(catalog.move(b.player.moves[z].id).power||0)-(catalog.move(b.player.moves[a].id).power||0))[0]??-1;b.act({type:'move',index});}
  command();assert.equal(b.turn,turn);assert.equal(b.actorPos,1);for(let i=0;i<30&&b.phase==='battle';i++)command();assert.equal(b.phase,'won');assert.equal(b.awarded.size,2);c.snapshot();
});
test('tile scripts persist source graphics and collision as one transaction',()=>{
  const c=fresh(),map=pack.maps.map_mauville_city_gym;position(c,map);const id=catalog.scriptData.constants.METATILE_MauvilleGym_FloorTile;runScript(c,'Start::\n setmetatile 4, 5, METATILE_MauvilleGym_FloorTile, FALSE\n end','Start');assert.equal(c.tile(4,5),'.');assert.equal(c.state.metatiles[map.id]['4,5'].id,id);const before=c.snapshot();assert.throws(()=>runScript(c,'Start::\n setmetatile 4, 5, METATILE_MauvilleGym_FloorTile, TRUE\n special Missing\n end','Start'));assert.deepEqual(c.snapshot(),before);new Campaign(catalog,pack,c.snapshot());
});
test('map callbacks and coordinate conditions use source tables',()=>{
  assert.ok(mapEntryScripts(pack.maps.map_oldale_town).includes('OldaleTown_OnTransition'));const c=fresh();c.state.position={map:'map_route101',x:0,y:0};c.state.vars.VAR_ROUTE101_STATE=0;assert.equal(frameScript(c),'Route101_EventScript_HideMapNamePopup');const map=structuredClone(c.map);map.coordEvents=[{x:0,y:0,var:'VAR_TEST',var_value:'2',script:'Entry'}];c.pack={...c.pack,maps:{...c.pack.maps,[map.id]:map}};assert.equal(coordinateScript(c),null);c.state.vars.VAR_TEST=2;assert.equal(coordinateScript(c),'Entry');
});

test('parallel actor movements are presented once at the source waitmovement barrier',async()=>{
 const c=fresh(),custom=structuredClone(pack);custom.maps.field.events=[{kind:'dialogue',x:13,y:10,localId:'LOCALID_TEST',text:'NPC'}];const state=c.snapshot();state.position={map:'field',x:12,y:10};const scene=new Campaign(catalog,custom,state),requests=[];
 await runInteractiveScript(scene,'Start::\n applymovement LOCALID_PLAYER, Walk\n applymovement LOCALID_TEST, Walk\n waitmovement 0\n msgbox EndText, MSGBOX_DEFAULT\n end\nWalk:\n walk_down\n step_end\nEndText:\n .string "Done.$"','Start',{present:true,choose:async r=>{requests.push(r);return 1;}});
 assert.deepEqual(requests.map(r=>r.kind),['movement','message']);assert.equal(requests[0].actors.length,2);assert.equal(requests[0].startState.position.y,10);assert.equal(scene.state.position.y,11);assert.equal(scene.visibleEvents()[0].y,11);
});
