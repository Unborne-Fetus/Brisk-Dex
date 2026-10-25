import{test}from'node:test';import assert from'node:assert/strict';import{catalog,pack}from'./helpers.mjs';import{experience}from'../../game/model.mjs';import{importGbaSave,readGbaSave,sectionChecksum,originalGbaBytes}from'../../game/gba-import.mjs';import{encodeSave,decodeSave}from'../../game/storage.mjs';
import{makeGbaSave as save}from'./gba-fixture.mjs';
const layout={maps:{'0:0':{nativeMap:'field'}}};
test('current 20-box save imports party, box 20, money, bag and minted nature without changing input',async()=>{const bytes=save(),copy=bytes.slice(),{campaign:c,report}=await importGbaSave(bytes,catalog,pack,layout);assert.deepEqual(bytes,copy);assert.equal(c.state.party.length,1);assert.equal(c.state.boxes.length,1);assert.equal(c.state.party[0].nature,17);assert.equal(c.state.party[0].level,12);assert.equal(c.state.party[0].moves[0].pp,50);assert.equal(c.state.party[0].moves[0].ppUps,3);assert.equal(c.state.inventory[28],7);assert.equal(c.state.money,123456);assert.equal(c.state.boxes[0].gba.box,19);assert.equal(report.archived.length,0);assert.deepEqual(await originalGbaBytes(c.state),bytes);assert.deepEqual((await decodeSave(await encodeSave(c.snapshot()))).party,c.state.party);});
test('legacy 14-box saves and complete older-bank fallback are supported',async()=>{const bytes=save({modern:false,corruptBank:true}),{campaign:c,report}=await importGbaSave(bytes,catalog,pack,layout);assert.equal(report.saveCounter,4);assert.equal(report.boxCount,14);assert.equal(c.state.boxes[0].gba.box,13);});
test('corrupt records and eggs are archived instead of silently discarded or rewritten',async()=>{for(const option of [{egg:true},{corruptMon:true}]){const bytes=save(option),{campaign:c,report}=await importGbaSave(bytes,catalog,pack,layout);assert.equal(report.archived.length,1);assert.equal(c.state.party[0].species,255);assert.deepEqual(await originalGbaBytes(c.state),bytes);}});
test('incomplete/mixed expanded sectors and invalid save banks are rejected',()=>{const bytes=save();bytes[29*4096+14]^=1;assert.throws(()=>readGbaSave(bytes,catalog),/Expanded PC/);assert.throws(()=>readGbaSave(save({corruptBank:true}),catalog),/another save generation/);assert.throws(()=>readGbaSave(new Uint8Array(128*1024),catalog),/checksum-valid/);assert.throws(()=>readGbaSave(new Uint8Array(400),catalog),/raw/);});
test('original archive export verifies integrity and does not manufacture an updated GBA save',async()=>{const {campaign:c}=await importGbaSave(save(),catalog,pack,layout);c.state.money=1;assert.notEqual(new DataView((await originalGbaBytes(c.state)).buffer).getUint32(0x490,true),1);c.state.gbaSource.sha256='0'.repeat(64);await assert.rejects(()=>originalGbaBytes(c.state),/checksum/);});
test('PP Ups survive healing and remain bounded',async()=>{const {campaign:c}=await importGbaSave(save(),catalog,pack,layout),m=c.state.party[0];c.catalog.heal(m);assert.equal(m.moves[0].pp,56);m.moves[0].pp=57;assert.throws(()=>c.snapshot(),/PP/);});
test('padded flash dumps, RTC footers and header-wrapped saves import without changing the original file',async()=>{
 const raw=save();
 for(const [prefix,suffix]of [[0,16],[0,0x20000],[512,0],[71,32]]){
  const bytes=new Uint8Array(prefix+raw.length+suffix);bytes.fill(255);bytes.set(raw,prefix);
  const {campaign:c,report}=await importGbaSave(bytes,catalog,pack,layout);
  assert.equal(c.state.party[0].level,12);assert.equal(c.state.boxes[0].gba.box,19);assert.equal(report.container.offset,prefix);assert.deepEqual(await originalGbaBytes(c.state),bytes);
 }
 const mirrored=new Uint8Array(raw.length*2);mirrored.set(raw);mirrored.set(raw,raw.length);assert.equal(readGbaSave(mirrored,catalog).boxCount,20);
});
test('binary views honor exact byte offsets',()=>{
 const raw=save(),outer=new Uint8Array(raw.length+34);outer.set(raw,17);const view=new DataView(outer.buffer,17,raw.length);assert.equal(readGbaSave(view,catalog).boxCount,20);
});
test('recovery rejects truncated expanded saves and unrelated large payloads',()=>{
 assert.throws(()=>readGbaSave(save().slice(0,0xe000),catalog),/single-bank backup/);
 const bytes=new Uint8Array(0x40000);bytes.set(save());bytes.fill(42,0x20000);assert.throws(()=>readGbaSave(bytes,catalog),/checksum-valid/);
 assert.throws(()=>readGbaSave({unexpected:true},catalog),/not binary/);
});
test('gzip battery saves import and retain exact original compressed bytes',async()=>{
 const {gzipSync}=await import('node:zlib'),raw=save(),compressed=new Uint8Array(gzipSync(raw)),{campaign:c,report}=await importGbaSave(compressed,catalog,pack,layout);assert.equal(report.container.compression,'gzip');assert.equal(c.state.party[0].level,12);assert.deepEqual(await originalGbaBytes(c.state),compressed);
});
