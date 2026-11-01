'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {gzipSync}=require('node:zlib');
const {NativeUpdater,sha256,unpack,validateManifest,resolveActiveRoot,safePath,atomic}=require('../../native-updater');
function bundle(sequence=1,extra=[]){
 const names=['main.js','preload.js','index.html','package.json','native-updater.js','native-settings-ui.js','native-controls.js','native-embedded.js','brisk-dex-data.json','native-game/linux/pokeemerald-native','native-game/linux/build-info.json'];
 const files=names.map(name=>{
  const value=name.endsWith('build-info.json')?JSON.stringify({profile:'brisk',save_layout_id:0x42524b31,embedded_protocol:2}):'build '+sequence;
  const data=Buffer.from(value);return {path:name,mode:name.endsWith('pokeemerald-native')?0o755:0o644,sha256:sha256(data),data:data.toString('base64')};
 });
 const bytes=gzipSync(JSON.stringify({format:'brisk-runtime',api:1,platform:'linux',arch:'x64',files:[...files,...extra]}));
 return {bytes,manifest:{format:'brisk-update',api:1,platform:'linux',arch:'x64',version:'1.3.0',sequence,saveLayout:0x42524b31,sha256:sha256(bytes),bytes:bytes.length,asset:'runtime-'+sha256(bytes)+'.json.gz'}};
}
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-updates-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'package.json'),'{"version":"1.3.0"}');
 let current=bundle();
 const updater=new NativeUpdater({userData:dir,bundledRoot:dir,platform:'linux',arch:'x64',fetcher:async url=>new Response(url.endsWith('.json')?JSON.stringify(current.manifest):current.bytes)});
 return {dir,updater,setBundle:value=>current=value};
}
test('download, apply, confirmed restart and rollback preserve player saves',async t=>{
 const {dir,updater,setBundle}=await setup(t);
 const saves=path.join(dir,'native-brisk-emerald');await fs.mkdir(saves);await fs.writeFile(path.join(saves,'pokeemerald.sav'),'player profiles');
 assert.equal((await updater.check()).ready,true);
 assert.equal((await updater.state()).current,null);
 await updater.activate();
 const active=await resolveActiveRoot(dir,dir);assert.notEqual(active,dir);
 if(process.platform!=='win32')assert.equal((await fs.stat(path.join(active,'native-game/linux/pokeemerald-native'))).mode&0o777,0o755);
 await updater.confirm();assert.equal(await resolveActiveRoot(dir,dir),active);
 setBundle(bundle(2));assert.equal((await updater.check()).ready,true);await updater.activate();await resolveActiveRoot(dir,dir);await updater.confirm();
 await updater.rollback();assert.equal(await resolveActiveRoot(dir,dir),active);
 assert.equal((await updater.check()).ready,undefined,'do not redownload the update that was rolled back');
 assert.equal(await fs.readFile(path.join(saves,'pokeemerald.sav'),'utf8'),'player profiles');
});
test('failed first launch returns to the bundled app; downloads never become active prematurely',async t=>{
 const {dir,updater}=await setup(t);
 await updater.check();assert.equal(await resolveActiveRoot(dir,dir),dir);
 await updater.activate();assert.notEqual(await resolveActiveRoot(dir,dir),dir);
 assert.equal(await resolveActiveRoot(dir,dir),dir);
 assert.equal((await updater.check()).ready,undefined,'failed updates stay skipped');
});
test('offline, damaged downloads, wrong platforms and path traversal leave installed state alone',async t=>{
 const {dir,updater,setBundle}=await setup(t);
 updater.fetcher=async()=>{throw new Error('offline');};assert.equal((await updater.check()).ok,false);assert.equal(await resolveActiveRoot(dir,dir),dir);
 const good=bundle();assert.throws(()=>unpack(Buffer.from('broken'),good.manifest),/checksum/);
 assert.throws(()=>validateManifest(good.manifest,'win32','x64'),/incompatible/);
 for(const name of ['../main.js','/main.js','C:/save','native-brisk-emerald/pokeemerald.sav','dir\\main.js'])assert.equal(safePath(name),false);
 const bad=bundle(3,[{path:'../escape',mode:0o644,sha256:sha256(Buffer.from('x')),data:'eA=='}]);
 assert.throws(()=>unpack(bad.bytes,bad.manifest),/Unsafe/);
 assert.equal((await updater.state()).current,null);
});
test('automatic checking preference persists and a missing update channel is nonfatal',async t=>{
 const {updater}=await setup(t);await updater.configure(false);assert.equal((await updater.config()).automatic,false);
 updater.fetcher=async()=>new Response('',{status:404});assert.equal((await updater.check()).ok,true);
 await assert.rejects(updater.configure('yes'),/preference/);
});
