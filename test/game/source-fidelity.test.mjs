import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,pack,catalog} from './helpers.mjs';
import {Campaign,migrateCampaign} from '../../game/world.mjs';
import {runScript} from '../../game/scripts.mjs';

test('source import includes Hoenn story interiors, endgame and Brisk custom maps',()=>{
  assert.ok(Object.values(pack.maps).filter(m=>m.sourceMap).length>=550);
  for(const id of ['map_ever_grande_city_champions_room','map_meteor_falls_1f_1r','map_sky_pillar_top','map_evolution_cave','map_route135','map_orange_city'])assert.ok(pack.maps[id],id);
  assert.ok(pack.sharedScripts.includes('Common_EventScript_ShowPokemonCenterSign'));
});
test('source hide flags control both drawing candidates and collision',()=>{
  const c=fresh(),custom=structuredClone(pack);custom.maps.field.events=[{kind:'dialogue',x:13,y:10,text:'NPC',hideFlag:'FLAG_HIDE_TEST',localId:'LOCALID_TEST'}];
  const state=c.snapshot();state.position={map:'field',x:12,y:10};const campaign=new Campaign(catalog,custom,state);
  assert.equal(campaign.move(1,0).kind,'blocked');campaign.state.flags.FLAG_HIDE_TEST=true;
  assert.equal(campaign.visibleEvents().length,0);assert.equal(campaign.move(1,0).kind,'step');
});
test('object script changes persist and roll back with unsupported commands',()=>{
  const c=fresh(),custom=structuredClone(pack);custom.maps.field.events=[{kind:'dialogue',x:13,y:10,text:'NPC',localId:'LOCALID_TEST'}];const state=c.snapshot();state.position={map:'field',x:12,y:10};const campaign=new Campaign(catalog,custom,state);
  runScript(campaign,'Start::\n setobjectxy LOCALID_TEST, 14, 10\n end','Start');assert.equal(campaign.visibleEvents()[0].x,14);
  const before=campaign.snapshot();assert.throws(()=>runScript(campaign,'Start::\n removeobject LOCALID_TEST\n special Unsupported\n end','Start'));assert.deepEqual(campaign.snapshot(),before);
  runScript(campaign,'Start::\n removeobject LOCALID_TEST\n end','Start');assert.equal(campaign.visibleEvents().length,0);new Campaign(catalog,custom,campaign.snapshot());
});
test('source elevation prevents crossing stacked paths but permits transition elevations',()=>{
  const c=fresh(),custom=structuredClone(pack);custom.maps.field.events=[];custom.maps.field.elevations=Array.from({length:custom.maps.field.height},()=>Array(custom.maps.field.width).fill(3));custom.maps.field.elevations[10][13]=4;const state=c.snapshot();state.position={map:'field',x:12,y:10};const campaign=new Campaign(catalog,custom,state);
  assert.equal(campaign.move(1,0).kind,'blocked');custom.maps.field.elevations[10][13]=0;assert.equal(campaign.move(1,0).kind,'step');
});
test('source checkflag, conditional calls and switch preserve event branching',()=>{
  const c=fresh();runScript(c,'Start::\n setflag FLAG_TEST\n checkflag FLAG_TEST\n call_if_eq VAR_RESULT, TRUE, Reward\n switch VAR_RESULT\n case 1, Done\n setflag FLAG_WRONG\nDone::\n end\nReward::\n giveitem ITEM_POTION, 1\n return','Start');assert.equal(c.state.inventory[28],6);assert.equal(c.state.flags.FLAG_WRONG,undefined);
});
test('older campaigns acquire source visibility defaults without losing explicit flags',()=>{
  const c=fresh(),state=c.snapshot();delete state.sourceObjectVersion;state.flags={FLAG_HIDE_ROUTE_101_ZIGZAGOON:false,keep:true};const restored=migrateCampaign(state,pack,catalog);assert.equal(restored.state.flags.keep,true);assert.equal(restored.state.flags.FLAG_HIDE_ROUTE_101_ZIGZAGOON,false);assert.equal(restored.state.sourceObjectVersion,1);assert.deepEqual(restored.state.party,state.party);
});
