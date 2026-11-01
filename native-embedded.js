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
async function engineInfo(executable){
  try{
    const info=JSON.parse(await fs.readFile(path.join(path.dirname(executable),'build-info.json'),'utf8'));
    if(!['brisk','expansion'].includes(info.profile))throw new Error('Unknown game profile');
    return {profile:info.profile,briskCommit:info.brisk_commit||null,protocol:info.embedded_protocol||1};
  }catch(error){
    if(error.code==='ENOENT')return {profile:'expansion'}; // existing native builds
    return {error:'The native engine build information is invalid. Rebuild Pokemon Brisk Emerald.'};
  }
}
async function embeddedStatus({platform=process.platform,resources=process.resourcesPath}={}){
  if(!['linux','win32'].includes(platform))return {status:'unsupported',message:'Native expansion gameplay is currently Windows/Linux desktop only.'};
  const executable=bundledGamePath({platform,resources});
  const checked=await validateNativeExecutable(executable,platform);
  if(!checked.ok)return {status:'not-installed',message:'The integrated native engine was not included in this build. Rebuild Pokemon Brisk Emerald with the native source integration enabled.'};
  const info=await engineInfo(executable);
  if(info.error)return {status:'invalid-build',message:info.error};
  return {status:'ready',...info,message:info.profile==='brisk'?'Integrated Brisk Emerald is ready.':'Integrated expansion engine is ready.'};
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
      if(start<0){this.pending=this.pending.subarray(Math.max(0,this.pending.length-3));break;}
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
    this.errorTail='';this.keys=0;this.options={speed:1,paused:false,mute:false};this.protocol=1;
    this.frameCount=0;this.lastFrameTime=0;this.blackSince=0;this.blackFrames=0;
    this.diagnosticReason=null;this.diagnosticTimer=null;this.engineCommit=null;
  }
  send(event,payload){
    if(this.webContents&&!this.webContents.isDestroyed())this.webContents.send(event,payload);
  }
  noteFrame(frame){
    this.lastFrameTime=Date.now();this.frameCount++;
    // Sample a spread of real BGR555 pixels; a fade should recover quickly.
    let blank=true;
    for(let i=0;i<PIXELS;i+=512){
      if(frame.readUInt16LE(i)!==0){blank=false;break;}
    }
    if(blank){this.blackFrames++;this.blackSince||=this.lastFrameTime;}
    else{this.blackSince=0;this.blackFrames=0;}
    if(this.blackSince&&this.lastFrameTime-this.blackSince>10000&&!this.options.paused)
      this.recordDiagnostic('Continuous black game frames for more than 10 seconds');
    this.send('native-game-frame',new Uint8Array(frame));
  }
  async recordDiagnostic(reason,extra={}){
    if(this.diagnosticReason)return;
    this.diagnosticReason=reason;
    const report={format:'brisk-native-diagnostic',version:1,at:new Date().toISOString(),
      reason,platform:this.platform,engineCommit:this.engineCommit,frames:this.frameCount,
      lastFrameAt:this.lastFrameTime?new Date(this.lastFrameTime).toISOString():null,
      consecutiveBlackFrames:this.blackFrames,paused:this.options.paused,
      errorTail:this.errorTail.slice(-1500),...extra};
    try{
      const directory=path.join(this.userData,'native-diagnostics');
      await fs.mkdir(directory,{recursive:true});
      const output=path.join(directory,'last-native-failure.json');
      await fs.writeFile(output+'.tmp',JSON.stringify(report,null,2),'utf8');
      await fs.rename(output+'.tmp',output);
      this.send('native-game-state',{running:!!this.child,message:'Native game issue detected. Diagnostic saved to '+output});
    }catch(error){this.send('native-game-state',{running:!!this.child,message:'Native diagnostic could not be saved: '+error.message});}
  }
  async exportDiagnostics(){
    const file=path.join(this.userData,'native-diagnostics','last-native-failure.json');
    try{return {ok:true,diagnostic:JSON.parse(await fs.readFile(file,'utf8'))};}
    catch(error){return {ok:false,error:error.code==='ENOENT'?'No native failure has been recorded.':error.message};}
  }
  async start(){
    if(this.stopping)return {ok:false,error:'The game is still stopping. Try again in a moment.'};
    if(this.starting)return this.starting;
    this.starting=this.startProcess();
    try{return await this.starting;}finally{this.starting=null;}
  }
  async startProcess(){
    if(this.child)return {ok:true,alreadyRunning:true};
    const status=await embeddedStatus({platform:this.platform,resources:this.resources});
    if(status.status!=='ready')return {ok:false,error:status.message};
    this.protocol=status.protocol||1;this.engineCommit=status.briskCommit||null;
    const executable=bundledGamePath({platform:this.platform,resources:this.resources});
    const dataDir=path.join(this.userData,status.profile==='brisk'?'native-brisk-emerald':'native-expansion');
    await fs.mkdir(dataDir,{recursive:true});
    this.errorTail='';this.frameCount=0;this.lastFrameTime=0;
    this.blackSince=0;this.blackFrames=0;this.diagnosticReason=null;
    const decoder=new PacketDecoder(frame=>this.noteFrame(frame));
    this.decoder=decoder;
    let child;
    try{
      child=this.spawnChild(executable,['--headless','--data-dir',dataDir],{
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
    child.stdout.on('data',part=>{if(this.child===child)decoder.push(part);});
    child.stderr.on('data',part=>{this.errorTail=(this.errorTail+part.toString('utf8')).slice(-1500);});
    this.diagnosticTimer=setInterval(()=>{
      if(this.child===child&&!this.options.paused&&this.lastFrameTime&&Date.now()-this.lastFrameTime>12000)
        this.recordDiagnostic('Game stopped producing video frames for more than 12 seconds');
    },2000);
    this.diagnosticTimer.unref?.();
    child.on('exit',(code,signal)=>{
      if(this.child===child){
        clearInterval(this.diagnosticTimer);this.diagnosticTimer=null;
        const intentional=!!this.stopping;
        if(!intentional&&code!==0)this.recordDiagnostic('Native process exited unexpectedly',{exitCode:code,signal});
        this.child=null;
        this.send('native-game-state',{running:false,code,signal,
          message:code===0?'Game stopped.':('Native engine stopped: '+(this.errorTail.trim()||String(code??signal)))});
      }
    });
    child.on('error',error=>{
      if(this.child===child){clearInterval(this.diagnosticTimer);this.diagnosticTimer=null;
        this.recordDiagnostic('Native process error',{error:error.message});
        this.child=null;this.send('native-game-state',{running:false,message:error.message});}
    });
    return await new Promise(resolve=>{
      child.once('spawn',()=>{this.writeInput();this.send('native-game-state',{running:true});resolve({ok:true});});
      child.once('error',error=>resolve({ok:false,error:error.message}));
    });
  }
  input(value){
    if(!Number.isInteger(value)||value<0||value>0x3ff)return false;
    this.keys=value;return this.writeInput();
  }
  configure(options){
    if(!options||![0,1,2,3,4].includes(options.speed)||typeof options.paused!=='boolean'||typeof options.mute!=='boolean')return {ok:false,error:'Invalid game settings.'};
    this.options={speed:options.speed,paused:options.paused,mute:options.mute};
    this.writeInput();
    return this.child&&this.protocol<2?{ok:false,error:'Rebuild the native engine once to enable speed, pause and audio controls.'}:{ok:true};
  }
  writeInput(){
    if(!this.child?.stdin?.writable)return false;
    const {speed,paused,mute}=this.options;
    const word=this.keys|(this.protocol>=2?((speed<<10)|(Number(paused)<<13)|(Number(mute)<<14)):0);
    const keys=Buffer.allocUnsafe(2);keys.writeUInt16LE(word);
    try{return this.child.stdin.write(keys);}
    catch(error){return false;}
  }
  async stop(){
    if(this.starting)await this.starting;
    if(this.stopping)return this.stopping;
    if(!this.child)return {ok:true};
    this.input(0);
    const child=this.child;
    this.stopping=new Promise(resolve=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');},5000);
      timer.unref?.();
      child.once('exit',()=>{clearTimeout(timer);resolve({ok:true});});
      child.kill();
    });
    try{return await this.stopping;}finally{this.stopping=null;}
  }
}
module.exports={WIDTH,HEIGHT,PIXELS,HEADER,PacketDecoder,bundledGamePath,embeddedStatus,EmbeddedNativeGame};
