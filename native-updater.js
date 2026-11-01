'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {gunzipSync}=require('node:zlib');
const REPO='Unborne-Fetus/Brisk-Dex';
const CHANNEL='https://github.com/'+REPO+'/releases/download/updates/';
const MAX_DOWNLOAD=180*1024*1024,MAX_EXPANDED=600*1024*1024;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaPattern=/^[a-f0-9]{64}$/;
function safePath(name){
  return typeof name==='string'&&name.length<240&&!name.includes('\\')&&!name.includes(':')&&!name.includes('\0')&&!name.startsWith('/')&&name.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!/[. ]$/.test(s)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))&&!/^(node_modules|\.git|native-brisk-emerald|native-expansion)(\/|$)/.test(name);
}
async function jsonFile(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
async function atomic(file,data){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,data,{flag:'wx'});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
}
async function readResponse(response,limit){
  if(!response.ok)throw new Error('Update server returned HTTP '+response.status+'.');
  if(Number(response.headers.get('content-length'))>limit)throw new Error('Update download is too large.');
  const chunks=[];let size=0;
  if(!response.body)throw new Error('The update download was empty.');
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new Error('Update download is too large.');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
function validateManifest(value,platform,arch){
  if(!value||value.format!=='brisk-update'||value.api!==1||value.platform!==platform||value.arch!==arch||!shaPattern.test(value.sha256)||!/^\d+\.\d+\.\d+$/.test(value.version)||!Number.isSafeInteger(value.sequence)||value.sequence<1||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>MAX_DOWNLOAD||value.saveLayout!==0x42524b31||value.asset!=='runtime-'+value.sha256+'.json.gz')throw new Error('This update is incompatible or its manifest is invalid.');
  return value;
}
function unpack(bytes,manifest){
  if(bytes.length!==manifest.bytes||sha256(bytes)!==manifest.sha256)throw new Error('Update download checksum failed.');
  const payload=JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_EXPANDED}).toString('utf8'));
  if(payload.format!=='brisk-runtime'||payload.api!==1||payload.platform!==manifest.platform||payload.arch!==manifest.arch||!Array.isArray(payload.files)||payload.files.length>40000)throw new Error('Invalid runtime package.');
  const seen=new Set(),files=[];let total=0;
  for(const item of payload.files){
    if(!item||!safePath(item.path)||seen.has(item.path)||!shaPattern.test(item.sha256)||typeof item.data!=='string'||![0o644,0o755].includes(item.mode))throw new Error('Unsafe update file.');
    const data=Buffer.from(item.data,'base64');total+=data.length;
    if(total>MAX_EXPANDED||data.toString('base64')!==item.data||sha256(data)!==item.sha256)throw new Error('An update file is damaged.');
    seen.add(item.path);files.push({...item,data});
  }
  const engine='native-game/'+manifest.platform+'/'+(manifest.platform==='win32'?'pokeemerald-native.exe':'pokeemerald-native');
  for(const name of ['main.js','preload.js','native-settings-ui.js','native-controls.js','index.html','package.json','native-updater.js','native-embedded.js','brisk-dex-data.json',engine,'native-game/'+manifest.platform+'/build-info.json',...(manifest.platform==='win32'?['native-game/win32/SDL2.dll']:[])])if(!seen.has(name))throw new Error('The update is missing '+name+'.');
  const info=JSON.parse(files.find(f=>f.path==='native-game/'+manifest.platform+'/build-info.json').data);
  if(info.profile!=='brisk'||info.save_layout_id!==manifest.saveLayout||info.embedded_protocol<2)throw new Error('The update engine uses an incompatible save or controls format.');
  return files;
}
class NativeUpdater{
  constructor({userData,bundledRoot,platform=process.platform,arch=process.arch,fetcher=fetch}){
    this.root=path.join(userData,'app-updates');this.bundledRoot=bundledRoot;this.platform=platform;this.arch=arch;this.fetcher=fetcher;this.busy=false;
  }
  async state(){return jsonFile(path.join(this.root,'state.json'),{current:null,previous:null,pending:null});}
  async config(){return jsonFile(path.join(this.root,'settings.json'),{automatic:true});}
  async configure(automatic){if(typeof automatic!=='boolean')throw new Error('Invalid update preference.');await atomic(path.join(this.root,'settings.json'),JSON.stringify({automatic}));return {ok:true};}
  async status(){const state=await this.state();return {automatic:(await this.config()).automatic,current:state.current?.version||require(path.join(this.bundledRoot,'package.json')).version,pending:state.pending?.version||null,canRollback:!!state.current,busy:this.busy};}
  async check(download=true){
    if(this.busy)return {ok:false,message:'An update check is already running.'};
    if(!['win32','linux'].includes(this.platform)||this.arch!=='x64')return {ok:false,message:'Automatic game updates are available on Windows and Linux x64.'};
    this.busy=true;
    try{
      const response=await this.fetcher(CHANNEL+'latest-'+this.platform+'-'+this.arch+'.json',{signal:AbortSignal.timeout(20000),cache:'no-store'});
      if(response.status===404)return {ok:true,message:'The update channel has no published build yet.'};
      const manifest=validateManifest(JSON.parse((await readResponse(response,64000)).toString('utf8')),this.platform,this.arch);
      const state=await this.state();
      if([state.current,state.pending,state.previous].some(item=>item?.sha256===manifest.sha256))return {ok:true,message:state.pending?'Update ready. Save your game, then restart to apply it.':'You have the latest update.'};
      if(manifest.sequence<=Math.max(state.current?.sequence||0,state.pending?.sequence||0,state.skippedSequence||0))return {ok:true,message:state.pending?'Update ready. Save your game, then restart to apply it.':'You have the latest update.'};
      if(!download)return {ok:true,message:'An update is available.',available:manifest.version};
      const bytes=await readResponse(await this.fetcher(CHANNEL+manifest.asset,{signal:AbortSignal.timeout(180000)}),MAX_DOWNLOAD);
      const files=unpack(bytes,manifest);
      const name=manifest.sha256,dir=path.join(this.root,'versions',name),stage=dir+'.'+randomUUID()+'.tmp';
      await fs.mkdir(stage,{recursive:true});
      try{
        for(const file of files){const target=path.join(stage,file.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.data,{flag:'wx',mode:file.mode});}
        await atomic(path.join(stage,'update-build.json'),JSON.stringify(manifest));
        await fs.rm(dir,{recursive:true,force:true});await fs.rename(stage,dir);
      }finally{await fs.rm(stage,{recursive:true,force:true});}
      state.pending={...manifest,directory:name};
      await atomic(path.join(this.root,'state.json'),JSON.stringify(state));
      await this.prune();
      return {ok:true,ready:true,message:'Update '+manifest.version+' downloaded. Save your game, then restart to apply it.'};
    }catch(error){return {ok:false,message:'Update unavailable: '+error.message+' Your installed game is unchanged.'};}
    finally{this.busy=false;}
  }
  async activate(){
    if(this.busy)throw new Error('Wait for the update download to finish.');
    const state=await this.state();if(!state.pending)throw new Error('No downloaded update is ready.');
    state.previous=state.current;state.current=state.pending;state.pending=null;state.unconfirmed=true;
    await atomic(path.join(this.root,'state.json'),JSON.stringify(state));
  }
  async prune(){
    const state=await this.state(),keep=new Set([state.current?.directory,state.previous?.directory,state.pending?.directory]);
    const versions=path.join(this.root,'versions');let entries;
    try{entries=await fs.readdir(versions,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries)if(entry.isDirectory()&&shaPattern.test(entry.name)&&!keep.has(entry.name))await fs.rm(path.join(versions,entry.name),{recursive:true,force:true});
  }
  async confirm(){const state=await this.state();if(state.unconfirmed||state.launchAttempt){state.unconfirmed=false;state.launchAttempt=false;await atomic(path.join(this.root,'state.json'),JSON.stringify(state));}await this.prune();}
  async rollback(){
    if(this.busy)throw new Error('Wait for the update download to finish.');
    const state=await this.state();state.skippedSequence=Math.max(state.skippedSequence||0,state.current?.sequence||0);state.current=state.previous;state.previous=null;state.pending=null;state.unconfirmed=false;
    await atomic(path.join(this.root,'state.json'),JSON.stringify(state));
    await this.prune();
  }
}
async function resolveActiveRoot(userData,bundledRoot){
  const root=path.join(userData,'app-updates');
  let state;
  try{state=await jsonFile(path.join(root,'state.json'),null);}catch{return bundledRoot;}
  if(!state?.current)return bundledRoot;
  // One failed launch falls back on the next launch, without touching saves.
  if(state.launchAttempt){state.skippedSequence=Math.max(state.skippedSequence||0,state.current?.sequence||0);state.current=state.previous;state.previous=null;state.unconfirmed=false;state.launchAttempt=false;await atomic(path.join(root,'state.json'),JSON.stringify(state));}
  if(!state.current||!shaPattern.test(state.current.directory))return bundledRoot;
  const active=path.join(root,'versions',state.current.directory);
  try{
    const meta=await jsonFile(path.join(active,'update-build.json'),null);
    if(meta?.sha256!==state.current.directory)throw new Error('Missing runtime metadata');
    await fs.access(path.join(active,'main.js'));
    if(state.unconfirmed){state.launchAttempt=true;await atomic(path.join(root,'state.json'),JSON.stringify(state));}
    return active;
  }catch{return bundledRoot;}
}
module.exports={CHANNEL,MAX_DOWNLOAD,MAX_EXPANDED,sha256,safePath,validateManifest,unpack,atomic,NativeUpdater,resolveActiveRoot};
