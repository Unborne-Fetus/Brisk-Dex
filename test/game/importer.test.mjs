import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importMaps} from '../../tools/import_native_maps.mjs';
test('source importer preserves metatiles, collision, elevation, events and unresolved scripts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-map-test-'));
  try{
    await fs.mkdir(path.join(root,'data/maps/Test'),{recursive:true});await fs.mkdir(path.join(root,'data/layouts/Test'),{recursive:true});
    await fs.writeFile(path.join(root,'data/layouts/layouts.json'),JSON.stringify({layouts:[{id:'LAYOUT_TEST',width:2,height:2,blockdata_filepath:'data/layouts/Test/map.bin',primary_tileset:'gTileset_General',secondary_tileset:'gTileset_Cave'}]}));
    await fs.writeFile(path.join(root,'data/maps/Test/map.json'),JSON.stringify({id:'MAP_TEST',layout:'LAYOUT_TEST',object_events:[{x:1,y:1,script:'Test_EventScript'}],warp_events:[{dest_map:'MAP_OTHER',dest_warp_id:'0'}]}));
    const bytes=Buffer.alloc(8);bytes.writeUInt16LE(0x3c17);await fs.writeFile(path.join(root,'data/layouts/Test/map.bin'),bytes);await fs.writeFile(path.join(root,'data/maps/Test/scripts.inc'),'Test_EventScript:\n end');
    const imported=await importMaps(root,['Test']);assert.deepEqual(imported.maps.MAP_TEST.cells[0],{metatile:23,collision:3,elevation:3});assert.equal(imported.maps.MAP_TEST.runtimeReady,false);assert.equal(imported.report.untranslatedScripts[0].script,'Test_EventScript');assert.equal(imported.report.externalDestinations[0].destination,'MAP_OTHER');assert.ok(imported.maps.MAP_TEST.sourceScripts.includes('Test_EventScript'));
    await assert.rejects(()=>importMaps(root,['../escape']));await fs.writeFile(path.join(root,'data/layouts/Test/map.bin'),Buffer.alloc(2));await assert.rejects(()=>importMaps(root,['Test']),/block count/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
