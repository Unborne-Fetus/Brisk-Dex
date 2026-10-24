import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,pack} from './helpers.mjs';
import {encodeSave,decodeSave,sha256,MemoryRecords} from '../../game/storage.mjs';
import {ContentUpdates} from '../../game/updates.mjs';
import {IntegrationBridge,partySnapshot} from '../../game/integrations.mjs';
test('portable saves round-trip and detect corruption',async()=>{
  const state=fresh().snapshot(),save=await encodeSave(state);assert.deepEqual(await decodeSave(save),state);save.payload+=' ';await assert.rejects(()=>decodeSave(save),/checksum/);await assert.rejects(()=>decodeSave({format:'GBA'}),/not a standalone/);
});
test('integration DTO uses canonical data and never creates trusted GBA records',()=>{
  const c=fresh(),bridge=new IntegrationBridge(),request=bridge.prepareBattle(c,'doubles');assert.equal(request.format,'doubles');assert.equal(request.team[0].species,252);assert.equal(request.team[0].maxHP,c.catalog.stats(c.state.party[0])[0]);assert.equal(request.competitiveEligible,false);assert.equal(request.team[0].rewardRaw80,undefined);assert.ok(Object.entries(bridge.capabilities).filter(([key])=>key!=='gbaImport').every(([,v])=>v===false));assert.throws(()=>bridge.connect());assert.throws(()=>bridge.transfer());const snapshot=partySnapshot(c);snapshot.pokemon[0].hp=0;assert.notEqual(c.state.party[0].hp,0);
});
async function release(){const next=structuredClone(pack);next.version='prototype-3';const bytes=new TextEncoder().encode(JSON.stringify(next));return {next,bytes,manifest:{format:'brisk-native-release',schema:1,version:next.version,minimumEngine:1,url:'./content.json',sha256:await sha256(bytes),bytes:bytes.length}};}
function updater(manifest,bytes,records=new MemoryRecords()) {return new ContentUpdates({records,manifestURL:'https://updates.example.test/release.json',allowedOrigin:'https://updates.example.test',fetcher:async url=>new Response(String(url).endsWith('/release.json')?JSON.stringify(manifest):bytes)});}
test('updates verify origin, engine, byte count, hash and content before activation',async()=>{
  const {manifest,bytes,next}=await release(),records=new MemoryRecords(),u=updater(manifest,bytes,records),c=fresh();const found=await u.check(pack.version);assert.equal(found.version,next.version);const staged=await u.stage(found);assert.equal(await records.read('active'),null);const activated=await u.activate(staged,c);assert.equal(activated.state.contentVersion,next.version);assert.equal((await records.read('active')).version,next.version);assert.deepEqual((await records.read('rollback')).state,c.snapshot());assert.equal(c.pack.version,pack.version);
});
test('failed or incompatible updates preserve the previous active content and campaign',async()=>{
  const {manifest,bytes}=await release(),records=new MemoryRecords();await records.writeMany([['active',pack]]);const c=fresh(),before=c.snapshot(),u=updater(manifest,bytes,records);
  await assert.rejects(()=>u.stage({...manifest,sha256:'0'.repeat(64)}),/checksum/);await assert.rejects(()=>u.stage({...manifest,bytes:bytes.length-1}),/exceeds/);await assert.rejects(()=>u.stage({...manifest,url:'https://evil.example/content.json'}),/origin/);await assert.rejects(()=>u.stage({...manifest,minimumEngine:999}),/Unsupported/);
  const bad=structuredClone(pack);bad.version='bad';delete bad.maps.field;bad.start={map:'lab',x:12,y:14};bad.maps.lab.events=bad.maps.lab.events.filter(e=>e.kind!=='warp');bad.maps.cave.events=bad.maps.cave.events.filter(e=>e.map!=='field');await assert.rejects(()=>u.activate(bad,c));assert.deepEqual(await records.read('active'),pack);assert.deepEqual(c.snapshot(),before);
});
test('updater does no network work without explicit configuration',async()=>{const u=new ContentUpdates({fetcher:()=>{throw new Error('Should not fetch');}});await assert.rejects(()=>u.check('v1'),/not connected/);});
