'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {crc32,validateSave,createBackup,parseBackup,restoreBackup,saveDirectory}=require('../../native-saves');
function save(value=0){
  const bytes=Buffer.alloc(131072+28,value);bytes.write('PENSAVE\0');
  for(const [offset,number] of [[8,1],[12,64],[16,0x42524b31],[20,131072]])bytes.writeUInt32LE(number,offset);
  bytes.writeUInt32LE(crc32(bytes.subarray(28)),24);return bytes;
}
test('native backups reject GBA data, different game layouts, pointer widths and damaged saves',()=>{
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  assert.throws(()=>validateSave(Buffer.alloc(131072),'brisk'),/GBA/);
  for(const [offset,value] of [[8,2],[12,32],[16,1],[20,0],[100,91]]){
    const bad=save();bad.writeUInt32LE(value,offset);
    assert.throws(()=>validateSave(bad,'brisk'));
  }
});
test('backup roundtrip preserves the complete two-profile flash image and RTC, retaining old files',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-saves-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dir=saveDirectory(root,'brisk');await fs.mkdir(dir);
  const original=save(42);
  await fs.writeFile(path.join(dir,'pokeemerald.sav'),original);
  await fs.writeFile(path.join(dir,'pokeemerald.rtc'),'-3600\n');
  await fs.writeFile(path.join(dir,'settings.ini'),'volume=20\n');
  const backup=await createBackup(root,'brisk');
  assert.deepEqual(parseBackup(backup,'brisk').save,original);
  await fs.writeFile(path.join(dir,'pokeemerald.sav'),save(7));
  const {previous}=await restoreBackup(root,'brisk',backup);
  assert.deepEqual(await fs.readFile(path.join(dir,'pokeemerald.sav')),original);
  assert.deepEqual(await fs.readFile(path.join(previous,'pokeemerald.sav')),save(7));
  assert.equal(await fs.readFile(path.join(dir,'pokeemerald.rtc'),'utf8'),'-3600\n');
  assert.equal(await fs.readFile(path.join(dir,'settings.ini'),'utf8'),'volume=20\n');
  const invalid=JSON.parse(backup);invalid.rtc='../../outside';
  await assert.rejects(restoreBackup(root,'brisk',JSON.stringify(invalid)),/clock/);
  assert.deepEqual(await fs.readFile(path.join(dir,'pokeemerald.sav')),original);
  assert.throws(()=>parseBackup(backup,'expansion'),/currently installed/);
  assert.throws(()=>parseBackup('x'.repeat(200001),'brisk'),/large/);
});
test('restore without an RTC removes stale clock data and leaves the other engine saves alone',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-saves-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dir=saveDirectory(root,'brisk'),other=saveDirectory(root,'expansion');
  await fs.mkdir(dir);await fs.mkdir(other);
  await fs.writeFile(path.join(dir,'pokeemerald.sav'),save());
  const backup=await createBackup(root,'brisk');
  await fs.writeFile(path.join(dir,'pokeemerald.rtc'),'100\n');
  await fs.writeFile(path.join(other,'pokeemerald.sav'),'untouched');
  await restoreBackup(root,'brisk',backup);
  await assert.rejects(fs.stat(path.join(dir,'pokeemerald.rtc')),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(other,'pokeemerald.sav'),'utf8'),'untouched');
});
