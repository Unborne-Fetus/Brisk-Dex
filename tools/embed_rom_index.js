#!/usr/bin/env node
'use strict';
// Embed a compact, checksum-verified reference index in unused/padded GBA ROM
// space. The original ROM is never changed. Run this only with source-derived
// data generated from the SAME game revision as the compiled ROM.
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {crc32}=require('../gba-rom-import.js');
const MAGIC=Buffer.from('BDXROMZ!','ascii'),MAX_GBA=32*1024*1024,MAX_INDEX=12*1024*1024;
function usage(){
  console.error('Usage: node tools/embed_rom_index.js game.gba [game-indexed.gba]');
  process.exit(2);
}
function main(){
  const input=process.argv[2],output=process.argv[3]||input&&path.join(path.dirname(input),path.basename(input,'.gba')+'-indexed.gba');
  if(!input||!/^.+\.gba$/i.test(input)||!/^.+\.gba$/i.test(output))usage();
  if(path.resolve(input)===path.resolve(output))throw Error('Output must be a different path: source ROM is immutable.');
  const original=fs.readFileSync(input);
  if(original.length<0xC0||original[0xB2]!==0x96)throw Error('Input is not a valid Game Boy Advance ROM.');
  if(original.length>MAX_GBA)throw Error('This tool only supports ROMs up to the 32 MiB GBA address limit.');
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'..','brisk-dex-data.json'),'utf8'));
  const trainers=JSON.parse(fs.readFileSync(path.join(__dirname,'..','brisk-dex-trainer-teams.json'),'utf8'));
  if(!data.species||!Array.isArray(data.routeEncounters)||!Array.isArray(trainers.trainers))
    throw Error('Refresh Brisk Dex reference data from the matching ROM source before indexing.');
  data.trainerTeams=trainers.trainers;
  const manifest={format:'briskdex-rom-v1',meta:{
    source:'Brisk Dex source-derived data at ROM build time',
    warning:'The index is valid only if the data extraction and ROM build used the same game revision.'
  },data};
  const raw=Buffer.from(JSON.stringify(manifest),'utf8');
  if(raw.length>MAX_INDEX)throw Error('Reference index exceeds 12 MiB uncompressed limit.');
  const zipped=zlib.deflateSync(raw,{level:9});
  if(zipped.length>MAX_INDEX)throw Error('Compressed reference index is too large.');
  const footprint=zipped.length+16;
  let padStart=original.length;
  while(padStart>0xC0&&original[padStart-1]===0xFF)padStart--;
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
    ' · map/encounter areas '+data.routeEncounters.length);
  console.log('Index '+raw.length+' bytes raw / '+zipped.length+' bytes compressed; ROM '+length+' bytes.');
  console.log('The original ROM was not modified.');
}
try{main();}catch(e){console.error('ROM indexing failed: '+e.message);process.exitCode=1;}
