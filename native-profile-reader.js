'use strict';
// Read-only bridge from the native PENSAVE 128KiB flash image to Dex's legacy
// sector parser. Never write this synthetic view back to the game.
const fs=require('node:fs/promises'),path=require('node:path');
const {crc32,saveDirectory,validateSave}=require('./native-saves');
const FLASH=131072,SECTOR=4096,DATA=3968,PROFILE_MAGIC=0x32534b42,HEADER_MAGIC=0x32504642;
const RAW_PC_BYTES=48604,RAW_SB2_BYTES=0xf2c;
const SIG=0x08012025;

function checksum(bytes){
  let sum=0;
  for(let i=0;i<DATA;i+=4)sum=(sum+(bytes[i]|(bytes[i+1]<<8)|(bytes[i+2]<<16)|(bytes[i+3]<<24)))>>>0;
  return ((sum>>>16)+sum)&65535;
}
function fnv(bytes){
  let h=2166136261;
  for(const b of bytes)h=Math.imul(h^b,16777619)>>>0;
  return h>>>0;
}
function inflate(packed,expected){
  if(packed.length<4||packed[0]!==0x10||(packed[1]|packed[2]<<8|packed[3]<<16)!==expected)
    throw new Error('Invalid compressed profile header');
  if(expected<60000||expected>80000)throw new Error('Unsupported profile layout length');
  let src=4,at=0;
  const out=Buffer.alloc(expected);
  while(at<expected){
    if(src>=packed.length)throw new Error('Truncated profile');
    const flags=packed[src++];
    for(let bit=7;bit>=0&&at<expected;bit--){
      if(flags&(1<<bit)){
        if(src+2>packed.length)throw new Error('Truncated profile match');
        const high=packed[src++],low=packed[src++],length=(high>>4)+3,dist=((high&15)<<8|low)+1;
        if(dist>at||length>expected-at)throw new Error('Invalid profile match');
        for(let i=0;i<length;i++){out[at]=out[at-dist];at++;}
      }else{
        if(src>=packed.length)throw new Error('Truncated profile literal');
        out[at++]=packed[src++];
      }
    }
  }
  return out;
}
function parseCompactFlash(flash){
  if(flash.length!==FLASH)throw new Error('Wrong native flash size');
  const groups=new Map();
  let anyCompact=false;
  for(let physical=0;physical<32;physical++){
    const off=physical*SECTOR,dv=new DataView(flash.buffer,flash.byteOffset+off,SECTOR);
    if(dv.getUint32(0xff8,true)!==PROFILE_MAGIC)continue;
    anyCompact=true;
    const data=flash.subarray(off,off+DATA);
    if(checksum(data)!==dv.getUint16(0xff6,true))continue;
    const id=dv.getUint16(0xff4,true),slot=Math.floor((id-0x200)/32),index=(id-0x200)%32;
    const magic=dv.getUint32(DATA,true),packed=dv.getUint32(DATA+4,true);
    const rawSize=dv.getUint32(DATA+8,true),hash=dv.getUint32(DATA+12,true);
    const count=dv.getUint16(DATA+16,true),tag=dv.getUint8(DATA+18),generation=dv.getUint32(0xffc,true);
    if(magic!==HEADER_MAGIC||slot<0||slot>1||tag!==slot||index<0||index>=count||count<1||count>32||packed<4||packed>(count*DATA)||rawSize<60000||rawSize>80000)continue;
    const key=[slot,generation,packed,rawSize,hash,count].join(':');
    if(!groups.has(key))groups.set(key,{slot,generation,packed,rawSize,hash,count,chunks:new Map()});
    groups.get(key).chunks.set(index,Buffer.from(data));
  }
  const slots=[null,null];
  for(const group of groups.values()){
    if(group.chunks.size!==group.count)continue;
    const bytes=Buffer.concat(Array.from({length:group.count},(_,i)=>group.chunks.get(i)||Buffer.alloc(0))).subarray(0,group.packed);
    if(bytes.length!==group.packed||fnv(bytes)!==group.hash)continue;
    let raw;
    try{raw=inflate(bytes,group.rawSize);}catch{continue;}
    const previous=slots[group.slot];
    if(!previous||((group.generation-previous.generation)|0)>0)
      slots[group.slot]={generation:group.generation,raw};
  }
  if(anyCompact&&!slots.some(Boolean))throw new Error('No complete checksum-valid Brisk profile found');
  return {slots,anyCompact};
}
function pcOffset(raw){
  // An explicit, fail-closed layout probe: 20 box names are 9-byte terminated
  // game strings after the 20*30*80 Pokémon records.
  let best=-1,score=0,runnerUp=0;
  const max=Math.min(RAW_SB2_BYTES+DATA*4,raw.length-RAW_PC_BYTES);
  for(let start=RAW_SB2_BYTES+0x3100;start<=max;start+=4){
    if(raw[start]>19)continue;
    const rem=raw.length-start-RAW_PC_BYTES;
    if(rem<0||rem>14*116)continue;
    let n=0;
    for(let box=0;box<20;box++){
      const nameStart=start+48004+box*9;
      let seenFF=false;
      for(let i=0;i<9;i++)if(raw[nameStart+i]===0xff){seenFF=true;break;}
      if(seenFF)n++;
    }
    if(n>score){runnerUp=score;score=n;best=start;}
    else if(n>runnerUp)runnerUp=n;
  }
  if(score<16||score===runnerUp)throw new Error('Brisk storage layout could not be identified unambiguously');
  return best;
}
function makeVirtualSave(raw){
  const pc=pcOffset(raw),sb1=raw.subarray(RAW_SB2_BYTES,pc),storage=raw.subarray(pc,pc+RAW_PC_BYTES),sb3=raw.subarray(pc+RAW_PC_BYTES);
  if(sb1.length>DATA*4||sb3.length>14*116||storage.length!==RAW_PC_BYTES)throw new Error('Incompatible compact save section sizes');
  const flash=Buffer.alloc(FLASH);
  function put(physical,id,bytes,validLen,meta){
    const off=physical*SECTOR;
    bytes.copy(flash,off,0,validLen);
    if(meta)meta.copy(flash,off+DATA,0,Math.min(meta.length,116));
    const data=flash.subarray(off,off+DATA);
    flash.writeUInt16LE(id,off+0xff4);
    flash.writeUInt16LE(checksum(data),off+0xff6);
    flash.writeUInt32LE(SIG,off+0xff8);
    flash.writeUInt32LE(1,off+0xffc);
  }
  const slices=[raw.subarray(0,RAW_SB2_BYTES)];
  for(let i=0;i<4;i++)slices.push(sb1.subarray(i*DATA,(i+1)*DATA));
  for(let i=0;i<9;i++)slices.push(storage.subarray(i*DATA,(i+1)*DATA));
  for(let i=0;i<14;i++)put(i,i,slices[i],slices[i].length,sb3.subarray(i*116,(i+1)*116));
  for(let i=0;i<4;i++){
    const chunk=storage.subarray((9+i)*DATA,(10+i)*DATA);
    put(28+i,0x100+i,chunk,chunk.length);
  }
  return flash;
}
async function getNativeProfiles(userData,{running=false}={}){
  // Refuse to read while the game can be modifying the file.
  if(running)return {available:false,reason:'Save in the game menu, then stop the game to refresh Dex profiles.'};
  const dir=saveDirectory(userData,'brisk'),file=path.join(dir,'pokeemerald.sav');
  let native;
  try{native=await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return {available:false,reason:'No integrated game save exists yet.'};throw e;}
  validateSave(native,'brisk');
  const flash=native.subarray(28);
  const {slots,anyCompact}=parseCompactFlash(flash);
  if(!anyCompact){
    // One-time migration: this is an old single-profile Brisk save; display it
    // as slot 1, never write a converted file behind the game's back.
    return {available:true,format:'legacy',profiles:[{slot:0,occupied:true,virtualSave:Uint8Array.from(flash)},{slot:1,occupied:false}]};
  }
  return {available:true,format:'compact',profiles:slots.map((p,slot)=>p?{
    slot,occupied:true,generation:p.generation,virtualSave:Uint8Array.from(makeVirtualSave(p.raw))
  }:{slot,occupied:false})};
}
module.exports={getNativeProfiles,parseCompactFlash,makeVirtualSave,pcOffset,inflate,checksum,fnv};
