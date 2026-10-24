import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {catalog,pack,fresh} from './helpers.mjs';import {Campaign} from '../../game/world.mjs';import {runInteractiveScript} from '../../game/scripts.mjs';import {refreshWildlife,meetWildlife} from '../../game/overworld.mjs';import {coordinateScript,sightedTrainer} from '../../game/scenes.mjs';
catalog.storyData=JSON.parse(fs.readFileSync(new URL('../../game/story-data.json',import.meta.url)));catalog.scriptData=JSON.parse(fs.readFileSync(new URL('../../game/script-data.json',import.meta.url)));
const source=pack.sharedScripts+'\n'+Object.values(pack.maps).map(m=>m.scriptText||'').join('\n');
const choose=async r=>r.kind==='clock'?'12:34':r.kind==='nickname'?r.name:r.kind==='starter'?'SNIVY':r.kind==='battle'?{phase:'won',state:r.state}:1;
for(const gender of ['Male','Female'])test(`${gender} opening uses source moving-in, clock, TV and Birch starter scripts`,async()=>{
 const c=Campaign.begin(catalog,pack,{name:'Spencer',gender},42),house=gender==='Female'?'Mays':'Brendans',script='LittlerootTown_'+house+'House',run=entry=>runInteractiveScript(c,source,entry,{choose});
 assert.equal(c.state.party.length,0);assert.equal(c.state.flags.FLAG_RESCUED_BIRCH,undefined);assert.equal(c.state.flags.FLAG_SYS_POKEMON_GET,undefined);
 await run('InsideOfTruck_EventScript_SetIntroFlags');assert.equal(c.state.dynamicWarp.x,gender==='Female'?12:3);
 c.state.position=structuredClone(c.state.dynamicWarp);await run('LittlerootTown_EventScript_StepOffTruck'+gender);assert.equal(c.map.id,'map_littleroot_town_'+house.toLowerCase()+'_house_1f');
 await run(script+'_1F_OnLoad');await run(script+'_1F_OnTransition');await run(script+'_1F_EventScript_EnterHouseMovingIn');assert.equal(c.state.vars.VAR_LITTLEROOT_INTRO_STATE,4);
 c.state.position={map:'map_littleroot_town_'+house.toLowerCase()+'_house_2f',x:gender==='Female'?1:7,y:1};await run(script+'_2F_OnTransition');c.state.position={map:c.map.id,x:5,y:2};await run(script+'_2F_EventScript_WallClock');assert.equal(c.state.clock,'12:34');assert.equal(c.state.flags.FLAG_SET_WALL_CLOCK,true);
 c.state.position={map:'map_littleroot_town_'+house.toLowerCase()+'_house_1f',x:gender==='Female'?2:8,y:3};await run(script+'_1F_OnTransition');await run(script+'_1F_EventScript_PetalburgGymReport');assert.equal(c.state.vars.VAR_LITTLEROOT_INTRO_STATE,7);
 c.state.position={map:'map_route101',x:10,y:19};c.state.vars.VAR_ROUTE101_STATE=1;assert.equal(coordinateScript(c),'Route101_EventScript_StartBirchRescue');await run('Route101_EventScript_StartBirchRescue');refreshWildlife(c);await run('Route101_EventScript_BirchsBag');assert.equal(c.state.party[0].species,catalog.id('SNIVY'));assert.equal(c.state.vars.VAR_STARTER_MON,0);assert.equal(c.state.flags.FLAG_RESCUED_BIRCH,true);assert.equal(c.state.nextId,2);assert.equal(c.map.id,'map_littleroot_town_professor_birchs_lab');
 await run('LittlerootTown_ProfessorBirchsLab_EventScript_GiveStarterEvent');assert.equal(c.state.vars.VAR_BIRCH_LAB_STATE,3);c.snapshot();
});
test('source rival, Pokédex and Wally tutorial advance the early story and preserve the player party',async()=>{
 const c=fresh(),run=entry=>runInteractiveScript(c,source,entry,{choose});c.state.position={map:'map_route103',x:10,y:8};c.state.vars.VAR_FACING=2;
 await run('Route103_EventScript_Rival');assert.equal(c.state.vars.VAR_BIRCH_LAB_STATE,4);assert.equal(c.state.flags.FLAG_DEFEATED_RIVAL_ROUTE103,true);
 c.state.position={map:'map_littleroot_town_professor_birchs_lab',x:6,y:5};await run('LittlerootTown_ProfessorBirchsLab_EventScript_GivePokedex');assert.equal(c.state.flags.FLAG_SYS_POKEDEX_GET,true);assert.equal(c.state.vars.VAR_LITTLEROOT_TOWN_STATE,3);
 const party=structuredClone(c.state.party);c.state.position={map:'map_petalburg_city_gym',x:4,y:108};c.state.vars.VAR_FACING=2;await run('PetalburgCity_Gym_OnTransition');await run('PetalburgCity_Gym_EventScript_Norman');await run('PetalburgCity_EventScript_WallyTutorial');await run('PetalburgCity_Gym_OnTransition');await run('PetalburgCity_Gym_EventScript_ReturnFromWallyTutorial');assert.deepEqual(c.state.party,party);assert.equal(c.state.vars.VAR_PETALBURG_GYM_STATE,2);assert.equal(c.state.vars.VAR_PETALBURG_CITY_STATE,3);c.snapshot();
});
test('visible encounters retain their species, level, shiny state and identity across native saves',()=>{
 const c=fresh();c.state.options.overworldEncounters=true;c.state.position={map:'map_route101',x:15,y:10};refreshWildlife(c);assert.ok(c.state.wildlife.actors.length>0);assert.equal(c.state.wildlife.actors.length,3);
 const before=c.snapshot(),restored=new Campaign(catalog,pack,structuredClone(before));refreshWildlife(restored);assert.deepEqual(restored.state.wildlife,before.wildlife);const actor=restored.state.wildlife.actors[0],expected=structuredClone(actor.mon),result=meetWildlife(restored,actor.x,actor.y);assert.deepEqual(result.mon,expected);assert.equal(restored.state.wildlife.actors.length,2);assert.equal(meetWildlife(restored,actor.x,actor.y),null);restored.snapshot();
});
test('trainer sight respects facing, distance, obstacles and defeated trainers',()=>{
 const c=fresh();c.state.position={map:'map_route102',x:37,y:10};const e=sightedTrainer(c);assert.equal(e?.id,'TRAINER_CALVIN_1');c.state.flags[e.id]=true;assert.notEqual(sightedTrainer(c)?.id,e.id);for(const event of c.map.events.filter(e=>e.kind==='trainer'))c.state.flags[event.id]=true;assert.equal(sightedTrainer(c),null);
});
test('cancelling the starter case rolls back the rescue and leaves the save playable',async()=>{
 const c=Campaign.begin(catalog,pack);c.state.position={map:'map_route101',x:9,y:15};const before=c.snapshot();await assert.rejects(()=>runInteractiveScript(c,source,'Route101_EventScript_BirchsBag',{choose:async()=>null}),/cancelled/);assert.deepEqual(c.snapshot(),before);
});
