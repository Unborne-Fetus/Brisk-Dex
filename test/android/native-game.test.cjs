'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync(path.join(__dirname,'../../android-native/src/mobile-native-game.js'),'utf8');
const moduleUrl=pathToFileURL(path.join(__dirname,'../../android-native/src/mobile-native-game.js')).href;

test('Android uses pinned native plugin and never silently launches a ROM or remote player',async()=>{
  const previousWindow=global.window,previousDocument=global.document;
  const calls=[],callbacks={};
  const plugin={
    async status(){return {status:'not-installed',message:'Native source has not been ported to Android.'};},
    async start(){calls.push('start');return {ok:false,error:'Core library missing'};},
    async frame(){calls.push('frame');return {};},
    async keys({mask}){calls.push(mask);},
    async configure(){calls.push('configure');return {ok:true};},
    async addListener(name,cb){callbacks[name]=cb;return {remove(){}};}
  };
  global.window={};
  global.document={documentElement:{classList:{add(){}}}};
  try{
    const {installAndroidNativeGame}=await import(moduleUrl);
    const api=installAndroidNativeGame({
      Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'},
      registerPlugin(name){assert.equal(name,'BriskNativeGame');return plugin;}
    });
    assert.equal(global.window.briskDexAPI,api);
    assert.equal((await api.getNativeGameStatus()).status,'not-installed');
    assert.equal((await api.startNativeGame()).ok,false);
    assert.ok(!calls.includes('frame'),'never render a fake game when core absent');
    api.sendNativeKeys(1023);api.sendNativeKeys(1024);api.sendNativeKeys(-1);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(calls,['start',1023]);
    assert.equal((await api.configureNativeGame({speed:4,paused:false,mute:false})).ok,true);
    assert.deepEqual(calls,['start',1023],'settings are cached until game starts');
    const diagnostic=await api.exportNativeDiagnostics();
    assert.equal(diagnostic.ok,true);
    assert.equal(diagnostic.diagnostic.platform,'android');
    assert.equal(diagnostic.diagnostic.engineStatus,'not-installed');
    assert.equal(diagnostic.diagnostic.frames,0);
    assert.equal((await api.configureNativeGame({speed:5,paused:false,mute:false})).ok,false);
    assert.equal((await api.configureNativeGame({speed:2,paused:'false',mute:false})).ok,false);
    assert.deepEqual(calls,['start',1023],'invalid settings never reach the native core');
  }finally{
    if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
    if(previousDocument===undefined)delete global.document;else global.document=previousDocument;
  }
});

test('Android writes edited PC flash through the guarded save-slot bridge',async()=>{
  const previousWindow=global.window,previousDocument=global.document;
  const updates=[];
  global.window={};
  global.document={documentElement:{classList:{add(){}}}};
  try{
    const {installAndroidNativeGame}=await import(moduleUrl);
    const api=installAndroidNativeGame({
      Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'},
      registerPlugin(){return {
        async addListener(){return {remove(){}};},
        async updateProfile(input){
          updates.push(input);
          return {ok:true,crc:-3};
        }
      };}
    });
    const flash=new Uint8Array(131072);
    flash[0]=25;flash[131071]=44;
    const result=await api.updateNativeGameProfile(1,flash,-9);
    assert.equal(result.ok,true);
    assert.equal(result.crc,-3);
    assert.equal(updates.length,1);
    assert.equal(updates[0].slot,1);
    assert.equal(updates[0].expectedCrc,-9);
    assert.deepEqual(Buffer.from(updates[0].flash,'base64'),Buffer.from(flash));
    assert.equal((await api.updateNativeGameProfile(2,flash,-9)).ok,false);
    assert.equal((await api.updateNativeGameProfile(0,new Uint8Array(10),-9)).ok,false);
    assert.equal(updates.length,1,'invalid transfers must not reach the native game');
  }finally{
    if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
    if(previousDocument===undefined)delete global.document;else global.document=previousDocument;
  }
});

test('Not installed on ordinary browsers or iOS',async()=>{
  const {installAndroidNativeGame}=await import(moduleUrl);
  for(const platform of ['web','ios']){
    const result=installAndroidNativeGame({
      Capacitor:{isNativePlatform:()=>platform!=='web',getPlatform:()=>platform},
      registerPlugin(){throw new Error('must not register on '+platform);}
    });
    assert.equal(result,null);
  }
});

test('Android exposes two independently validated app-managed native game slots',async()=>{
  const previousWindow=global.window,previousDocument=global.document;
  const {crc32}=await import(pathToFileURL(path.join(__dirname,'../../android-native/src/native-profiles.js')).href);
  function put32(bytes,offset,value){
    new DataView(bytes.buffer).setUint32(offset,value,true);
  }
  function save(fill){
    const bytes=new Uint8Array(131100);
    bytes.set([80,69,78,83,65,86,69,0]);
    put32(bytes,8,1);put32(bytes,12,64);
    put32(bytes,16,0x42524b31);put32(bytes,20,131072);
    bytes[28]=fill;
    put32(bytes,24,crc32(bytes.subarray(28)));
    return Buffer.from(bytes).toString('base64');
  }
  const original=[save(17),save(29)];
  let selected=1;
  const calls=[];
  const native={
    async profiles(){return {available:true,nativeSaves:original,activeSlot:selected};},
    async selectSlot({slot}){calls.push(slot);selected=slot;return {ok:true,activeSlot:slot};},
    async addListener(){return {remove(){}};}
  };
  global.window={};
  global.document={documentElement:{classList:{add(){}}}};
  try{
    const {installAndroidNativeGame}=await import(moduleUrl);
    const api=installAndroidNativeGame({
      Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'},
      registerPlugin(){return native;}
    });
    const state=await api.getNativeGameProfiles();
    assert.equal(state.available,true);
    assert.equal(state.format,'brisk-dex-managed');
    assert.equal(state.activeSlot,1);
    assert.equal(state.profiles.length,2);
    assert.equal(state.profiles[0].occupied,true);
    assert.equal(state.profiles[1].occupied,true);
    assert.equal(state.profiles[0].virtualSave[0],17);
    assert.equal(state.profiles[1].virtualSave[0],29);
    assert.deepEqual(await api.selectNativeGameSlot(0),{ok:true,activeSlot:0});
    assert.deepEqual(calls,[0]);
    assert.equal((await api.getNativeGameProfiles()).activeSlot,0);
    assert.equal((await api.selectNativeGameSlot(2)).ok,false);
    assert.deepEqual(calls,[0]);
    original[1]=original[1].slice(0,-4)+'aaaa';
    const invalid=await api.getNativeGameProfiles();
    assert.equal(invalid.available,false);
    assert.match(invalid.reason,/validation|CRC/);
  }finally{
    if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
    if(previousDocument===undefined)delete global.document;else global.document=previousDocument;
  }
});
