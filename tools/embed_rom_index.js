#!/usr/bin/env node
'use strict';
// Embed a compact, checksum-verified reference index in unused/padded GBA ROM
// space. The original ROM is never changed. Run this only with source-derived
// data generated from the SAME game revision as the compiled ROM.
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const {crc32}=require('../gba-rom-import.js');
const MAGIC=Buffer.from('BDXROMZ!','ascii'),MAX_GBA=32*1024*1024,MAX_INDEX=48*1024*1024;
function usage(){
  console.error('Usage: node tools/embed_rom_index.js game.gba [game-indexed.gba] [--with-art] [--no-icons]');
  process.exit(2);
}
function main(){
  const args=process.argv.slice(2).filter(arg=>arg!=='--no-icons'&&arg!=='--with-art');
  const input=args[0],output=args[1]||input&&path.join(path.dirname(input),path.basename(input,'.gba')+'-indexed.gba');
  if(!input||!/^.+\.gba$/i.test(input)||!/^.+\.gba$/i.test(output))usage();
  if(path.resolve(input)===path.resolve(output))throw Error('Output must be a different path: source ROM is immutable.');
  const original=fs.readFileSync(input);
  if(original.length<0xC0||original[0xB2]!==0x96)throw Error('Input is not a valid Game Boy Advance ROM.');
  if(original.length>MAX_GBA)throw Error('This tool only supports ROMs up to the 32 MiB GBA address limit.');
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'..','brisk-dex-data.json'),'utf8'));
  const trainers=JSON.parse(fs.readFileSync(path.join(__dirname,'..','brisk-dex-trainer-teams.json'),'utf8'));
  if(!Array.isArray(trainers.trainers)||!Array.isArray(data.routeEncounters)||!Array.isArray(data.mapCatalog))
    throw Error('Refresh Brisk Dex source data: trainer teams, wild encounters, and custom map catalog must all be exported before indexing.');
  for(const key of ['species','moves','abilities','items','itemDetails']){
    if(!data[key]||typeof data[key]!=='object'||Array.isArray(data[key])||!Object.keys(data[key]).length)
      throw Error('Missing '+key+' export; regenerate all reference tables from the exact ROM source revision before indexing.');
  }
  if(!data.mapCatalog.length)
    throw Error('Map catalog is empty. Run the extractor on a checkout with data/maps/map.json definitions to include added routes and regions.');
  data.trainerTeams=trainers.trainers;
  // The source exporter uses paths relative to the Brisk Dex checkout.
  // They would otherwise resolve against the recipient's *different* bundled
  // game and display incorrect artwork for same-numbered Fakémon.
  const includeArt=process.argv.includes('--with-art');
  const artRoot=path.resolve(__dirname,'..');
  const fields=['frontSprite','backSprite','frontShinySprite','backShinySprite',
    'frontAnimation','backAnimation','frontShinyAnimation','backShinyAnimation','cry'];
  const mimetypes={png:'image/png',gif:'image/gif',wav:'audio/wav',ogg:'audio/ogg',mp3:'audio/mpeg'};
  let artCount=0,artBytes=0;
  for(const species of Object.values(data.species)){
    if(!species||typeof species!=='object')continue;
    for(const field of fields){
      const original=species[field];
      if(typeof original!=='string'||original.startsWith('data:'))continue;
      const valid=/^brisk-dex-(?:sprites|cries)\/[A-Za-z0-9_.-]+\.(?:png|gif|wav|ogg|mp3)$/i.test(original);
      if(!valid||!includeArt){delete species[field];continue;}
      const fullPath=path.resolve(artRoot,original);
      const ext=path.extname(original).slice(1).toLowerCase();
      if(!fullPath.startsWith(artRoot+path.sep)||!fs.existsSync(fullPath)){delete species[field];continue;}
      const asset=fs.readFileSync(fullPath);
      if(asset.length>1024*1024)throw Error('Art asset is too large for ROM indexing: '+original);
      artBytes+=asset.length;
      species[field]='data:'+mimetypes[ext]+';base64,'+asset.toString('base64');
      artCount++;
    }
  }
  const assets={icons:{},shinyIcons:{}},iconsDir=path.join(__dirname,'..','brisk-dex-icons');
  if(!process.argv.includes('--no-icons')&&fs.existsSync(iconsDir)){
    for(const name of fs.readdirSync(iconsDir)){
      const match=name.match(/^(\d+)(_shiny)?\.png$/i);
      if(!match)continue;
      const dest=match[2]?assets.shinyIcons:assets.icons;
      dest[match[1]]='data:image/png;base64,'+fs.readFileSync(path.join(iconsDir,name)).toString('base64');
    }
  }
  let liveRomLength=original.length;
  while(liveRomLength>0xC0&&original[liveRomLength-1]===0xFF)liveRomLength--;
  const sourceFingerprint={algorithm:'sha256',liveRomLength,sha256:crypto.createHash('sha256').update(original.subarray(0,liveRomLength)).digest('hex')};
  const manifest={assets,format:'briskdex-rom-v1',meta:{
    sourceFingerprint,
    source:'Brisk Dex source-derived data at ROM build time',
    warning:'The index is valid only if the data extraction and ROM build used the same game revision.'
  },data};
  const raw=Buffer.from(JSON.stringify(manifest),'utf8');
  if(raw.length>MAX_INDEX)throw Error('Reference index exceeds 48 MiB uncompressed limit.');
  const zipped=zlib.deflateSync(raw,{level:9});
  if(zipped.length>12*1024*1024)throw Error('Compressed reference index exceeds 12 MiB. Use --no-icons or remove oversized artwork.');
  const footprint=zipped.length+16;
  const padStart=liveRomLength;
  let length=original.length;
  if(length-padStart<footprint){
    length=1;
    while(length<original.length+footprint)length*=2;
    if(length>MAX_GBA)throw Error('No safe ROM space for the index (requires '+footprint+' bytes). Rebuild the ROM with reserved padding. The source ROM is unchanged.');
  }
  const result=Buffer.alloc(length,0xFF);
  original.copy(result,0,0,original.length);
  const start=length-footprint;
  if(start<original.length && start<padStart)throw Error('Index would overwrite live ROM data.');
  zipped.copy(result,start);
  result.writeUInt32LE(zipped.length,start+zipped.length);
  result.writeUInt32LE(crc32(zipped,0,zipped.length),start+zipped.length+4);
  MAGIC.copy(result,start+zipped.length+8);
  fs.writeFileSync(output,result,{flag:'wx'});
  console.log('Indexed ROM written: '+output);
  console.log('Species '+Object.keys(data.species).length+
    ' · trainer teams '+data.trainerTeams.length+
    ' · map/encounter areas '+data.routeEncounters.length+
    ' · all maps '+data.mapCatalog.length+
    ' · items '+Object.keys(data.items).length);
  console.log('Icons '+Object.keys(assets.icons).length+' normal / '+Object.keys(assets.shinyIcons).length+' shiny.');
  console.log('Embedded battle art/cry assets: '+artCount+' ('+artBytes+' raw bytes). Use --with-art to include source files, subject to the 12 MiB reference budget.');
  console.log('Index '+raw.length+' bytes raw / '+zipped.length+' bytes compressed; ROM '+length+' bytes.');
  console.log('The original ROM was not modified.');
}
try{main();}catch(e){console.error('ROM indexing failed: '+e.message);process.exitCode=1;}
