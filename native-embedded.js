'use strict';
// Electron owns the internal game process; the renderer only sees frame bytes.
// BRISK_FRAME_STREAM is implemented by tools/patch-native-stream.py.
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {validateNativeExecutable}=require('./native-launcher');
const WIDTH=240,HEIGHT=160,PIXELS=WIDTH*HEIGHT*2,HEADER=8;
const MAGIC=Buffer.from('BEXP','ascii');
function bundledGamePath({platform=process.platform,resources=process.resourcesPath}={}){
  const name=platform==='win32'?'pokeemerald-native.exe':'pokeemerald-native';
  return path.join(resources,'native-game',platform,name);
}
async function embeddedStatus({platform=process.platform,resources=process.resourcesPath}={}){
  if(!['linux','win32'].includes(platform))return {status:'unsupported',message:'Native expansion gameplay is currently Windows/Linux desktop only.'};
  const executable=bundledGamePath({platform,resources});
  const checked=await validateNativeExecutable(executable,platform);
  return checked.ok
    ? {status:'ready',message:'Integrated expansion engine is ready.'}
    : {status:'not-installed',message:'The integrated native engine was not included in this build. Rebuild Brisk Dex with the native source integration enabled.'};
}
class PacketDecoder{
  constructor(onFrame){this.pending=Buffer.alloc(0);this.onFrame=onFrame;}
  push(chunk){
    if(!Buffer.isBuffer(chunk))chunk=Buffer.from(chunk);
    this.pending=Buffer.concat([this.pending,chunk]);
    // Stream always contains BEXP+LE32(76800)+BGR555; discard unrelated startup output.
    let latest=null;
    while(this.pending.length>=HEADER){
      const start=this.pending.indexOf(MAGIC);
      if(start<0){this.pending=this.pending.subarray(Math.max(0,this.pending.length-3));return;}
      if(start>0)this.pending=this.pending.subarray(start);
      if(this.pending.length<HEADER)break;
      if(this.pending.readUInt32LE(4)!==PIXELS){this.pending=this.pending.subarray(1);continue;}
      if(this.pending.length<HEADER+PIXELS)break;
      latest=Buffer.from(this.pending.subarray(HEADER,HEADER+PIXELS));
      this.pending=this.pending.subarray(HEADER+PIXELS);
    }
    if(latest)this.onFrame(latest);
    if(this.pending.length>PIXELS*3)this.pending=this.pending.subarray(-HEADER);
  }
}
class EmbeddedNativeGame{
  constructor({webContents,resources=process.resourcesPath,userData,platform=process.platform,spawnChild=spawn}){
    this.webContents=webContents;this.resources=resources;this.userData=userData;
    this.platform=platform;this.spawnChild=spawnChild;this.child=null;this.decoder=null;
    this.errorTail='';
  }
  send(event,payload){
    if(this.webContents&&!this.webContents.isDestroyed())this.webContents.send(event,payload);
  }
  async start(){
    if(this.child)return {ok:true,alreadyRunning:true};
    const status=await embeddedStatus({platform:this.platform,resources:this.resources});
    if(status.status!=='ready')return {ok:false,error:status.message};
    const executable=bundledGamePath({platform:this.platform,resources:this.resources});
    const dataDir=path.join(this.userData,'native-expansion');
    await fs.mkdir(dataDir,{recursive:true});
    this.errorTail='';
    this.decoder=new PacketDecoder(frame=>this.send('native-game-frame',new Uint8Array(frame)));
    let child;
    try{
      child=this.spawnChild(executable,['--headless','--silent','--data-dir',dataDir],{
        cwd:path.dirname(executable),stdio:['pipe','pipe','pipe'],windowsHide:true,
        env:{...process.env,BRISK_FRAME_STREAM:'1'}
      });
    }catch(error){return {ok:false,error:'Unable to start embedded native engine: '+error.message};}
    this.child=child;
    // A child that exits while a key is being sent can close stdin between
    // writable checks; never let EPIPE crash the companion app.
    child.stdin.on('error',error=>{
      this.send('native-game-state',{running:false,message:'Native input pipe closed: '+error.message});
    });
    child.stdout.on('data',part=>this.decoder.push(part));
    child.stderr.on('data',part=>{this.errorTail=(this.errorTail+part.toString('utf8')).slice(-1500);});
    child.on('exit',(code,signal)=>{
      if(this.child===child){
        this.child=null;
        this.send('native-game-state',{running:false,code,signal,
          message:code===0?'Game stopped.':('Native engine stopped: '+(this.errorTail.trim()||String(code??signal)))});
      }
    });
    child.on('error',error=>{
      if(this.child===child){this.child=null;this.send('native-game-state',{running:false,message:error.message});}
    });
    return await new Promise(resolve=>{
      child.once('spawn',()=>{this.send('native-game-state',{running:true});resolve({ok:true});});
      child.once('error',error=>resolve({ok:false,error:error.message}));
    });
  }
  input(value){
    if(!this.child?.stdin?.writable)return false;
    if(!Number.isInteger(value)||value<0||value>0x3ff)return false;
    const keys=Buffer.allocUnsafe(2);keys.writeUInt16LE(value);
    try{return this.child.stdin.write(keys);}
    catch(error){return false;}
  }
  stop(){
    if(!this.child)return {ok:true};
    this.input(0);
    this.child.kill();
    this.child=null;
    this.send('native-game-state',{running:false,message:'Game stopped.'});
    return {ok:true};
  }
}
module.exports={WIDTH,HEIGHT,PIXELS,HEADER,PacketDecoder,bundledGamePath,embeddedStatus,EmbeddedNativeGame};
