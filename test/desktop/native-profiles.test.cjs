'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const {getNativeProfiles,parseCompactFlash,makeVirtualSave,pcOffset,checksum,fnv}=require('../../native-profile-reader');
const {crc32}=require('../../native-saves');

function fixtureRaw(letter,randomizer){
  const pc=0xf2c+15000,raw=Buffer.alloc(pc+48604+200);
  raw[0]=letter;raw[1]=0xff;raw[pc]=0;
  for(let box=0;box<20;box++){
    const pos=pc+48004+box*9;
    raw[pos]=0xbb;raw[pos+1]=0xc9;raw[pos+2]=0xff;
  }
  const flag=0xf2c+0x139c+(0x40db-0x4000)*2;
  raw.writeUInt16LE(randomizer,flag);
  assert.equal(pcOffset(raw),pc);
  return raw;
}
function pack(raw){
  // Deterministic test encoder: 18-byte RLE/LZ matches at distance one.
  const output=[0x10,raw.length&255,(raw.length>>8)&255,(raw.length>>16)&255];
  let at=0;
  while(at<raw.length){
    const tokens=[];let flags=0;
    for(let bit=7;bit>=0&&at<raw.length;bit--){
      let size=0;
      if(at>0&&raw[at]===raw[at-1]){
        while(size<18&&at+size<raw.length&&raw[at+size]===raw[at-1])size++;
      }
      if(size>=3){
        flags|=1<<bit;
        tokens.push(((size-3)<<4)&255,0);at+=size;
      }else tokens.push(raw[at++]);
    }
    output.push(flags,...tokens);
  }
  return Buffer.from(output);
}
function fixtureFlash(){
  const flash=Buffer.alloc(131072);
  const raws=[fixtureRaw(0xbb,1),fixtureRaw(0xc9,0)];
  let physical=0;
  for(let slot=0;slot<2;slot++){
    const data=pack(raws[slot]),count=Math.ceil(data.length/3968),hash=fnv(data);
    assert.ok(count<16,'each fixture must leave space for a second profile');
    for(let i=0;i<count;i++){
      const off=(physical++)*4096,chunk=data.subarray(i*3968,(i+1)*3968);
      chunk.copy(flash,off);
      flash.writeUInt32LE(0x32504642,off+3968);
      flash.writeUInt32LE(data.length,off+3972);
      flash.writeUInt32LE(raws[slot].length,off+3976);
      flash.writeUInt32LE(hash,off+3980);
      flash.writeUInt16LE(count,off+3984);
      flash[off+3986]=slot;
      flash.writeUInt16LE(0x200+32*slot+i,off+0xff4);
      flash.writeUInt16LE(checksum(flash.subarray(off,off+3968)),off+0xff6);
      flash.writeUInt32LE(0x32534b42,off+0xff8);
      flash.writeUInt32LE(10+slot,off+0xffc);
    }
  }
  return {flash,raws};
}
test('two native compact slots decode independently with separate randomizer and options bytes',()=>{
  const {flash,raws}=fixtureFlash(),r=parseCompactFlash(flash);
  assert.equal(r.anyCompact,true);
  assert.deepEqual(r.slots.map(x=>x.generation),[10,11]);
  assert.deepEqual(r.slots[0].raw,raws[0]);
  assert.deepEqual(r.slots[1].raw,raws[1]);
  const a=makeVirtualSave(r.slots[0].raw),b=makeVirtualSave(r.slots[1].raw);
  assert.equal(a[0],0xbb);assert.equal(b[0],0xc9);
  const optionsAt=4096+0x139c+(0x40db-0x4000)*2;
  assert.equal(a.readUInt16LE(optionsAt),1);
  assert.equal(b.readUInt16LE(optionsAt),0);
  assert.equal(a.readUInt32LE(0xff8),0x08012025);
  assert.equal(a.readUInt16LE(28*4096+0xff4),0x100);
});
test('auto-detect native PENSAVE, expose both slots without modifying any file',async t=>{
  const userData=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-profile-test-'));
  t.after(()=>fs.rm(userData,{recursive:true,force:true}));
  const dir=path.join(userData,'native-brisk-emerald');await fs.mkdir(dir);
  const file=path.join(dir,'pokeemerald.sav');
  const {flash}=fixtureFlash(),container=Buffer.alloc(28+flash.length);
  container.write('PENSAVE\0',0,'ascii');container.writeUInt32LE(1,8);
  container.writeUInt32LE(64,12);container.writeUInt32LE(0x42524b31,16);
  container.writeUInt32LE(131072,20);flash.copy(container,28);
  container.writeUInt32LE(crc32(container.subarray(28)),24);
  await fs.writeFile(file,container);
  const original=await fs.readFile(file);
  const output=await getNativeProfiles(userData);
  assert.equal(output.available,true);assert.equal(output.format,'compact');
  assert.deepEqual(output.profiles.map(x=>x.occupied),[true,true]);
  assert.equal(output.profiles[0].virtualSave.length,131072);
  assert.equal(output.profiles[1].virtualSave.length,131072);
  assert.deepEqual(await fs.readFile(file),original);
  const blocked=await getNativeProfiles(userData,{running:true});
  assert.equal(blocked.available,false);
});
test('partial second profile never replaces the valid first slot',()=>{
  const {flash}=fixtureFlash();
  // Corrupt only one sector belonging to slot two.
  const second=Array.from({length:32},(_,i)=>i).find(i=>flash.readUInt16LE(i*4096+0xff4)===0x220);
  flash[second*4096+1]^=0x80;
  const r=parseCompactFlash(flash);
  assert.ok(r.slots[0]);assert.equal(r.slots[1],null);
});
