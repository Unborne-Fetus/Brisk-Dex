'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
function extract(first,last){
  const a=html.indexOf(first),b=html.indexOf(last,a+first.length);
  if(a<0||b<a)throw Error('Could not find '+first);
  return html.slice(a,b);
}
const functions=extract('function readBlock(bytes, blockOffset, profile){','function readStorageExtension(');
const context={
  Uint8Array,DataView,Array,Number,Object,window:{EmeraldCompat:{checksumSize:(_,id)=>id===0?3884:id===4?3848:id===13?2000:3968}},
  SECTION_SIZE:4096,SECTION_DATA_SIZE:3968,SIGNATURE:0x08012025,
  profileSaveConfig:profile=>profile.save||{},
  u16:(v,o)=>v.getUint16(o,true),
  u32:(v,o)=>v.getUint32(o,true)
};
// The extracted browser code references both window.EmeraldCompat and its
// global alias. Mirror browser globals in this isolated Node VM test.
context.EmeraldCompat=context.window.EmeraldCompat;
vm.createContext(context);
vm.runInContext(functions,context);
const bytes=new Uint8Array(128*1024),dv=new DataView(bytes.buffer);
for(let i=0;i<14;i++){
  const off=i*4096;
  dv.setUint16(off+4084,i,true); // ID
  dv.setUint16(off+4086,0,true); // checksum over zero bytes
  dv.setUint32(off+4088,0x08012025,true);
  dv.setUint32(off+4092,12,true);
}
const profile={save:{sectionCount:14,sectionSize:4096,sectionDataSize:3968,signature:0x08012025}};
let block=context.readBlock(bytes,0,profile);
assert.strictEqual(block.valid,true);
assert.strictEqual(block.validSections,14);
bytes[20]=5;
block=context.readBlock(bytes,0,profile);
assert.strictEqual(block.valid,false,'Corrupt payload must invalidate block');
assert.strictEqual(block.checksumFailures,1);
bytes[20]=0;
dv.setUint32(4092,99,true);
assert.strictEqual(context.readBlock(bytes,0,profile).valid,false,'Mixed save generations must be rejected');
dv.setUint32(4092,12,true);
dv.setUint16(4096+4084,0,true);
assert.strictEqual(context.readBlock(bytes,0,profile).valid,false,'Repeated section IDs must not masquerade as a full block');
console.log('Strict section checksum, ID and generation tests passed');
