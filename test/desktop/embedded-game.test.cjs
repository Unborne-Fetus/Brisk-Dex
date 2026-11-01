'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {PacketDecoder,PIXELS,EmbeddedNativeGame,embeddedStatus,bundledGamePath}=require('../../native-embedded');
const packet=(value=0x1234)=>{const frame=Buffer.alloc(PIXELS);frame.writeUInt16LE(value);const header=Buffer.alloc(8);header.write('BEXP');header.writeUInt32LE(PIXELS,4);return Buffer.concat([header,frame]);};
test('native packet decoder reconstructs fragmented BGR555 frames',()=>{
 const frames=[],decoder=new PacketDecoder(b=>frames.push(b));
 const raw=packet(0x6ab1);
 decoder.push(Buffer.concat([Buffer.from('startup log'),raw.subarray(0,5)]));
 assert.equal(frames.length,0);
 decoder.push(raw.subarray(5,900));
 decoder.push(raw.subarray(900));
 assert.equal(frames.length,1);
 assert.equal(frames[0].readUInt16LE(),0x6ab1);
 assert.equal(frames[0].length,PIXELS);
});
test('native packet parser resynchronizes after malformed headers and shows newest frame',()=>{
 const frames=[],decoder=new PacketDecoder(b=>frames.push(b));
 const malformed=Buffer.from('BEXP0000');malformed.writeUInt32LE(42,4);
 decoder.push(Buffer.concat([malformed,packet(4),packet(5)]));
 assert.equal(frames.length,1);
 assert.equal(frames[0].readUInt16LE(),5);
});
test('native executable comes from internal resources, never renderer-supplied path',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-internal-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const exe=bundledGamePath({platform:'win32',resources:root});
 assert.equal(exe,path.join(root,'native-game','win32','pokeemerald-native.exe'));
 assert.equal((await embeddedStatus({platform:'win32',resources:root})).status,'not-installed');
 await fs.mkdir(path.dirname(exe),{recursive:true});
 await fs.writeFile(exe,'mock');
 await fs.writeFile(path.join(path.dirname(exe),'SDL2.dll'),'mock');
 assert.equal((await embeddedStatus({platform:'win32',resources:root})).status,'ready');
 assert.equal((await embeddedStatus({platform:'darwin',resources:root})).status,'unsupported');
});
test('embedded process runs headless, forwards ten-bit keys, and never opens an extra window',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-game-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const exe=bundledGamePath({platform:'win32',resources:root});
 await fs.mkdir(path.dirname(exe),{recursive:true});
 await fs.writeFile(exe,'mock');
 await fs.writeFile(path.join(path.dirname(exe),'SDL2.dll'),'mock');
 let args,opts,child;
 const events=[];
 const mockSpawn=(file,a,o)=>{
  assert.equal(file,exe);args=a;opts=o;
  child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new PassThrough();child.kill=()=>{child.emit('exit',0,null);return true;};
  process.nextTick(()=>child.emit('spawn'));
  return child;
 };
 const game=new EmbeddedNativeGame({
  webContents:{isDestroyed:()=>false,send:(name,payload)=>events.push({name,payload})},
  resources:root,userData:path.join(root,'userdata'),platform:'win32',spawnChild:mockSpawn
 });
 assert.equal((await game.start()).ok,true);
 assert.equal(args[0],'--headless');
 assert.equal(args.includes('--silent'),false);
 assert.equal(opts.windowsHide,true);
 assert.equal(opts.env.BRISK_FRAME_STREAM,'1');
 assert.equal(game.input(-1),false);
 assert.equal(game.input(1024),false);
 const inputs=[];child.stdin.on('data',bytes=>inputs.push(bytes.readUInt16LE()));
 assert.equal(game.input(0x0201),true);
 assert.deepEqual(inputs,[0x201]);
 child.stdout.write(packet(0x7fff));
 assert.equal(events.filter(x=>x.name==='native-game-frame').length,1);
 assert.equal((await game.stop()).ok,true);
 assert.equal(game.child,null);
});

test('native decoder delivers a completed frame followed by diagnostic text',()=>{
 const frames=[],decoder=new PacketDecoder(frame=>frames.push(frame));
 decoder.push(Buffer.concat([packet(7),Buffer.from('startup diagnostic')]));
 assert.equal(frames.length,1);
 assert.equal(frames[0].readUInt16LE(),7);
});
