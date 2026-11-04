/* Read-only Android equivalent of native-profile-reader.js.
 * Validates PENSAVE / BRK1 and projects the two compact save slots into
 * the companion Dex. This never writes a synthetic save back to the game.
 */
const FLASH=131072, SECTOR=4096, DATA=3968;
const PROFILE_MAGIC=0x32534b42, HEADER_MAGIC=0x32504642;
const RAW_PC_BYTES=48604, RAW_SB2_BYTES=0xf2c, LEGACY_SIG=0x08012025;

function u32(bytes,offset){
  return (bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16|bytes[offset+3]<<24)>>>0;
}
function put16(bytes,offset,value){
  bytes[offset]=value&255;bytes[offset+1]=(value>>>8)&255;
}
function put32(bytes,offset,value){
  bytes[offset]=value&255;bytes[offset+1]=value>>>8&255;
  bytes[offset+2]=value>>>16&255;bytes[offset+3]=value>>>24&255;
}
export function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function checksum(bytes){
  let sum=0;
  for(let i=0;i<DATA;i+=4)sum=(sum+u32(bytes,i))>>>0;
  return ((sum>>>16)+sum)&65535;
}
function fnv(bytes){
  let hash=2166136261;
  for(const b of bytes)hash=Math.imul(hash^b,16777619)>>>0;
  return hash>>>0;
}
function inflate(packed,expected){
  if(packed.length<4||packed[0]!==0x10||
     (packed[1]|packed[2]<<8|packed[3]<<16)!==expected)
    throw new Error('Invalid compressed profile header');
  if(expected<60000||expected>80000)throw new Error('Unexpected native profile size');
  const output=new Uint8Array(expected);
  let src=4,at=0;
  while(at<expected){
    if(src>=packed.length)throw new Error('Truncated compact profile');
    const flags=packed[src++];
    for(let bit=7;bit>=0&&at<expected;bit--){
      if(flags&(1<<bit)){
        if(src+2>packed.length)throw new Error('Truncated compact profile match');
        const hi=packed[src++],lo=packed[src++],length=(hi>>4)+3,dist=((hi&15)<<8|lo)+1;
        if(dist>at||length>expected-at)throw new Error('Invalid profile backreference');
        for(let i=0;i<length;i++){output[at]=output[at-dist];at++;}
      }else{
        if(src>=packed.length)throw new Error('Truncated compact profile literal');
        output[at++]=packed[src++];
      }
    }
  }
  return output;
}
function compactProfiles(flash){
  const groups=new Map(),slots=[null,null];
  let anyCompact=false;
  for(let physical=0;physical<32;physical++){
    const off=physical*SECTOR;
    const sector=flash.subarray(off,off+SECTOR);
    if(u32(sector,0xff8)!==PROFILE_MAGIC)continue;
    anyCompact=true;
    const data=sector.subarray(0,DATA);
    if(checksum(data)!==(sector[0xff6]|sector[0xff7]<<8))continue;
    const id=sector[0xff4]|sector[0xff5]<<8;
    const slot=Math.floor((id-0x200)/32),index=(id-0x200)%32;
    const magic=u32(sector,DATA),packed=u32(sector,DATA+4),
      rawSize=u32(sector,DATA+8),hash=u32(sector,DATA+12),
      count=sector[DATA+16]|sector[DATA+17]<<8,
      tag=sector[DATA+18],generation=u32(sector,0xffc);
    if(magic!==HEADER_MAGIC||slot<0||slot>1||tag!==slot||index<0||
       count<1||count>32||index>=count||packed<4||packed>count*DATA||
       rawSize<60000||rawSize>80000)continue;
    const key=[slot,generation,packed,rawSize,hash,count].join(':');
    if(!groups.has(key))groups.set(key,{slot,generation,packed,rawSize,hash,count,chunks:new Map()});
    groups.get(key).chunks.set(index,new Uint8Array(data));
  }
  for(const group of groups.values()){
    if(group.chunks.size!==group.count)continue;
    const bytes=new Uint8Array(group.count*DATA);
    for(let i=0;i<group.count;i++)bytes.set(group.chunks.get(i),i*DATA);
    const packed=bytes.subarray(0,group.packed);
    if(fnv(packed)!==group.hash)continue;
    let raw;try{raw=inflate(packed,group.rawSize);}catch{continue;}
    const previous=slots[group.slot];
    if(!previous||((group.generation-previous.generation)|0)>0)
      slots[group.slot]={generation:group.generation,raw};
  }
  if(anyCompact&&!slots.some(Boolean))
    throw new Error('No complete checksum-valid native profile found');
  return {slots,anyCompact};
}
function pcOffset(raw){
  let best=-1,score=0,runnerUp=0;
  const max=Math.min(RAW_SB2_BYTES+DATA*4,raw.length-RAW_PC_BYTES);
  for(let start=RAW_SB2_BYTES+0x3100;start<=max;start+=4){
    if(raw[start]>19||raw[start+1]!==0||raw[start+2]!==0||raw[start+3]!==0)continue;
    const remaining=raw.length-start-RAW_PC_BYTES;
    if(remaining<0||remaining>14*116)continue;
    let good=0;
    for(let box=0;box<20;box++){
      const pos=start+48004+box*9;
      if(raw[pos]===0xff||raw[pos]===0)continue;
      for(let i=1;i<9;i++)if(raw[pos+i]===0xff){good++;break;}
    }
    if(good>score){runnerUp=score;score=good;best=start;}
    else if(good>runnerUp)runnerUp=good;
  }
  if(score<16||score===runnerUp)throw new Error('Native box layout could not be identified unambiguously');
  return best;
}
function makeVirtualSave(raw){
  const pc=pcOffset(raw),sb1=raw.subarray(RAW_SB2_BYTES,pc),
    storage=raw.subarray(pc,pc+RAW_PC_BYTES),sb3=raw.subarray(pc+RAW_PC_BYTES);
  if(sb1.length>DATA*4||sb3.length>14*116||storage.length!==RAW_PC_BYTES)
    throw new Error('Unsupported native profile storage layout');
  const flash=new Uint8Array(FLASH);
  function put(physical,id,chunk,meta){
    const off=physical*SECTOR;
    flash.set(chunk,off);
    if(meta)flash.set(meta.subarray(0,116),off+DATA);
    put16(flash,off+0xff4,id);
    put16(flash,off+0xff6,checksum(flash.subarray(off,off+DATA)));
    put32(flash,off+0xff8,LEGACY_SIG);
    put32(flash,off+0xffc,1);
  }
  const chunks=[raw.subarray(0,RAW_SB2_BYTES)];
  for(let i=0;i<4;i++)chunks.push(sb1.subarray(i*DATA,(i+1)*DATA));
  for(let i=0;i<9;i++)chunks.push(storage.subarray(i*DATA,(i+1)*DATA));
  for(let i=0;i<14;i++)put(i,i,chunks[i],sb3.subarray(i*116,(i+1)*116));
  for(let i=0;i<4;i++)put(28+i,0x100+i,storage.subarray((9+i)*DATA,(10+i)*DATA));
  return flash;
}
export function projectAndroidNativeSave(native){
  if(!(native instanceof Uint8Array)||native.length!==FLASH+28)
    throw new Error('Wrong PENSAVE length');
  const magic=[80,69,78,83,65,86,69,0];
  if(!magic.every((byte,i)=>byte===native[i])||u32(native,8)!==1||
     u32(native,12)!==64||u32(native,16)!==0x42524b31||u32(native,20)!==FLASH)
    throw new Error('Unsupported native Brisk save format');
  const flash=native.subarray(28);
  if(u32(native,24)!==crc32(flash))throw new Error('Native save CRC failed');
  const {slots,anyCompact}=compactProfiles(flash);
  if(!anyCompact){
    return {available:true,format:'legacy',profiles:[
      {slot:0,occupied:true,virtualSave:new Uint8Array(flash)},
      {slot:1,occupied:false}]};
  }
  return {available:true,format:'compact',profiles:slots.map((p,slot)=>p?{
    slot,occupied:true,generation:p.generation,virtualSave:makeVirtualSave(p.raw)
  }:{slot,occupied:false})};
}
