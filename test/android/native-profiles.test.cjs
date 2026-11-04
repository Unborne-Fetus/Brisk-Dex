'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const url=pathToFileURL(path.join(__dirname,'../../android-native/src/native-profiles.js')).href;
function pack32(target,i,value){
  target[i]=value&255;target[i+1]=(value>>>8)&255;
  target[i+2]=(value>>>16)&255;target[i+3]=(value>>>24)&255;
}
test('Android projects Windows BRK1 save and legacy single-slot profiles',async()=>{
  const {crc32,projectAndroidNativeSave}=await import(url);
  const bytes=new Uint8Array(131100);
  bytes.set([80,69,78,83,65,86,69,0]);
  pack32(bytes,8,1);pack32(bytes,12,64);
  pack32(bytes,16,0x42524b31);pack32(bytes,20,131072);
  pack32(bytes,24,crc32(bytes.subarray(28)));
  const result=projectAndroidNativeSave(bytes);
  assert.equal(result.available,true);
  assert.equal(result.format,'legacy');
  assert.equal(result.profiles[0].virtualSave.byteLength,131072);
  assert.equal(result.profiles[1].occupied,false);
});
test('Android rejects corrupt or mismatched native saves',async()=>{
  const {crc32,projectAndroidNativeSave}=await import(url);
  const bytes=new Uint8Array(131100);
  bytes.set([80,69,78,83,65,86,69,0]);
  pack32(bytes,8,1);pack32(bytes,12,64);
  pack32(bytes,16,0x42524b31);pack32(bytes,20,131072);
  pack32(bytes,24,crc32(bytes.subarray(28)));
  bytes[28]=1;
  assert.throws(()=>projectAndroidNativeSave(bytes),/CRC/);
  bytes[28]=0;
  pack32(bytes,16,0x12345678);
  assert.throws(()=>projectAndroidNativeSave(bytes),/Unsupported/);
});
