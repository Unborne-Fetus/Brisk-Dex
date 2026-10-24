#!/usr/bin/env node
// Preserve source data for staged porting. This does NOT translate event scripts.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function importMaps(source, names) {
  const root=await fs.realpath(source),read=async relative=>{
    const file=await fs.realpath(path.resolve(root,relative));
    if(!file.startsWith(root+path.sep))throw new Error('Source asset escaped the checkout');return fs.readFile(file);
  };
  const layouts=JSON.parse(await read('data/layouts/layouts.json')).layouts;
  const output={format:'brisk-source-map-archive',schema:1,maps:{},report:{maps:0,untranslatedScripts:[],externalDestinations:[],warnings:[]}};
  for(const name of names) {
    if(!/^[A-Za-z0-9_]+$/.test(name))throw new Error('Use a source map directory name');
    const map=JSON.parse(await read(`data/maps/${name}/map.json`)),layout=layouts.find(l=>l.id===map.layout);
    if(!layout)throw new Error(`Missing layout ${map.layout}`);
    const width=Number(layout.width),height=Number(layout.height);
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>1000000)throw new Error('Invalid source dimensions');
    const bytes=await read(layout.blockdata_filepath);if(bytes.length!==width*height*2)throw new Error(`Unexpected block count for ${name}`);
    const cells=Array.from({length:width*height},(_,i)=>{const v=bytes.readUInt16LE(i*2);return {metatile:v&0x3ff,collision:(v>>>10)&3,elevation:v>>>12};});
    let scripts='';try{scripts=(await read(`data/maps/${name}/scripts.inc`)).toString('utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    output.maps[map.id]={...map,width,height,primaryTileset:layout.primary_tileset,secondaryTileset:layout.secondary_tileset,cells,sourceScripts:scripts,runtimeReady:false};
    const pointers=new Set([...(map.object_events||[]),...(map.coord_events||[]),...(map.bg_events||[])].map(e=>e.script).filter(s=>s&&!['0','0x0','NULL'].includes(s)));
    output.report.untranslatedScripts.push(...[...pointers].map(script=>({map:map.id,script})));
    output.report.maps++;
  }
  for(const map of Object.values(output.maps))for(const warp of map.warp_events||[]) {
    if(!output.maps[warp.dest_map])output.report.externalDestinations.push({map:map.id,destination:warp.dest_map});
    else {const target=output.maps[warp.dest_map],index=Number(warp.dest_warp_id);if(!Number.isInteger(index)||!target.warp_events?.[index])output.report.warnings.push(`Unresolved warp ${map.id} -> ${warp.dest_map}:${warp.dest_warp_id}`);}
  }
  output.report.warnings.push('Metatile behavior, tileset graphics, scripts, movement and story conditions must be ported before these maps can be played. Collision bits alone are not complete traversal rules.');
  return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [source,destination,...names]=process.argv.slice(2);
  if(!source||!destination||!names.length){console.error('Usage: node tools/import_native_maps.mjs <Brisk checkout> <output.json> LittlerootTown Route101 ...');process.exitCode=1;}
  else {const data=await importMaps(source,names);await fs.writeFile(destination,JSON.stringify(data,null,2)+'\n');console.log(`Archived ${data.report.maps} maps; ${data.report.untranslatedScripts.length} scripts await porting.`);}
}
