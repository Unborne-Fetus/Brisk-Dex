import {projectAndroidNativeSave,crc32} from './native-profiles.js';
/* Capacitor Android adapter for the existing Brisk Emerald native game UI.
 * Requires an Android build of the same pinned C engine as Windows.
 * No GBA import, emulator, browser streaming, external PC or fake game.
 */
export function installAndroidNativeGame({Capacitor,registerPlugin}){
  if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android')return null;
  const native=registerPlugin('BriskNativeGame');
  const stateCallbacks=new Set(),frameCallbacks=new Set();
  let active=false,sequence=0,polling=false,expectedStop=false;
  let options={speed:1,paused:false,mute:false};
  let startedAt=0,lastFrameAt=0,frames=0,blackSince=0,blackFrames=0,frameErrors=0,lastDiagnostic=null;
  const FRAME_POLL_MS=16;
  function diagnostic(reason,details={}){
    if(lastDiagnostic?.reason===reason)return;
    lastDiagnostic={format:'brisk-native-diagnostic',version:1,platform:'android',
      at:new Date().toISOString(),reason,frames,lastFrameAt:lastFrameAt?new Date(lastFrameAt).toISOString():null,
      blackFrames,frameErrors,uptimeMs:startedAt?Date.now()-startedAt:0,...details};
  }
  function inspectFrame(bytes){
    const now=Date.now();
    frames++;lastFrameAt=now;frameErrors=0;
    let allBlack=true;
    for(let i=0;i<bytes.length;i+=1024){
      if(bytes[i]!==0||bytes[i+1]!==0){allBlack=false;break;}
    }
    if(allBlack){
      blackFrames++;blackSince||=now;
      if(!options.paused&&now-blackSince>10000)
        diagnostic('Game produced black frames for more than 10 seconds');
    }else{blackFrames=0;blackSince=0;}
  }
  function announce(value){
    for(const callback of stateCallbacks)try{callback(value);}catch(error){console.warn('Native game listener:',error);}
  }
  function decode(base64){
    const value=atob(base64),bytes=new Uint8Array(value.length);
    for(let i=0;i<value.length;i++)bytes[i]=value.charCodeAt(i);
    return bytes;
  }
  function encode(bytes){
    let binary='';
    for(let i=0;i<bytes.length;i+=0x8000)
      binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return btoa(binary);
  }
  function nativeContainer(header,virtualSave){
    if(!(virtualSave instanceof Uint8Array)||virtualSave.length!==131072)
      throw new Error('The migrated game slot has an invalid flash length');
    const result=new Uint8Array(28+virtualSave.length);
    result.set(header.subarray(0,28));
    result.set(virtualSave,28);
    new DataView(result.buffer).setUint32(24,crc32(virtualSave),true);
    return encode(result);
  }
  async function poll(){
    if(polling)return;
    polling=true;
    try{
      while(active){
        try{
          const packet=await native.frame({since:sequence});
          if(packet.pixels){
            const bytes=decode(packet.pixels);
            if(bytes.byteLength===76800){
              sequence=packet.seq;
              inspectFrame(bytes);
              for(const callback of frameCallbacks)try{callback(bytes);}catch(error){console.warn('Native frame callback:',error);}
            }else{
              frameErrors++;
            }
          }
        }catch(error){
          frameErrors++;
          if(frameErrors===5)diagnostic('Repeated Android frame bridge errors',{message:String(error).slice(0,500)});
          console.warn('Android native frame:',error);
        }
        if(active&&startedAt&&!options.paused&&Date.now()-(lastFrameAt||startedAt)>12000)
          diagnostic('Android game has not produced video for more than 12 seconds');
        if(active)await new Promise(resolve=>setTimeout(resolve,FRAME_POLL_MS));
      }
    }finally{
      polling=false;
      // A stop followed immediately by another start may overlap the previous
      // frame call. Keep the newly started session polling after it drains.
      if(active)void poll();
    }
  }
  void native.addListener('nativeState',event=>{
    active=event.running===true;
    if(active)void poll();
    else if(!expectedStop&&startedAt&&event.message&&event.message!=='Game stopped.')
      diagnostic('Android native game stopped unexpectedly',{message:String(event.message).slice(0,500)});
    announce(event);
  }).catch(console.warn);
  const api={
    async getNativeGameStatus(){return native.status();},
    async startNativeGame(){
      const started=await native.start();
      if(started.ok){
        expectedStop=false;active=true;sequence=0;startedAt=Date.now();
        lastFrameAt=0;frames=0;blackSince=0;blackFrames=0;frameErrors=0;lastDiagnostic=null;
        void poll();
        announce({running:true,message:'Launching native Android Brisk Emerald…'});
        void native.configure(options).catch(console.warn);
      }
      return started;
    },
    async stopNativeGame(){
      expectedStop=true;active=false;
      const result=await native.stop();
      sequence=0;
      announce({running:false,message:'Stopping Android game…'});
      return result;
    },
    sendNativeKeys(mask){
      if(Number.isInteger(mask)&&mask>=0&&mask<=1023)
        void native.keys({mask}).catch(error=>console.warn('Android game controls:',error));
    },
    async configureNativeGame(next){
      if(!next||!Number.isInteger(next.speed)||next.speed<0||next.speed>4||
         typeof next.paused!=='boolean'||typeof next.mute!=='boolean')
        return {ok:false,error:'Invalid Android game settings.'};
      options={speed:next.speed,paused:next.paused,mute:next.mute};
      if(!active)return {ok:true};
      return native.configure(options);
    },
    onNativeFrame(callback){frameCallbacks.add(callback);return ()=>frameCallbacks.delete(callback);},
    onNativeState(callback){stateCallbacks.add(callback);return ()=>stateCallbacks.delete(callback);},
    async getNativeGameProfiles(){
      let reply=await native.profiles();
      try{
        if(reply.requiresMigration){
          const original=decode(reply.nativeSave);
          const converted=projectAndroidNativeSave(original);
          if(converted.format!=='compact')throw new Error('The preserved source is not an in-game dual-slot save');
          const activeSlot=converted.profiles.findIndex(p=>p.occupied);
          if(activeSlot<0)throw new Error('No valid original profile was found');
          const saves=converted.profiles.map(profile=>profile.occupied
            ?nativeContainer(original,profile.virtualSave):null);
          const migrated=await native.migrateSlots({saves,activeSlot});
          if(!migrated.ok)throw new Error(migrated.error||'Android migration did not complete');
          reply=await native.profiles();
        }
        if(!reply.available)return reply;
        if(!Array.isArray(reply.nativeSaves)||reply.nativeSaves.length!==2||
           ![0,1].includes(reply.activeSlot))
          throw new Error('Android save slots returned invalid metadata');
        const profiles=reply.nativeSaves.map((encoded,slot)=>{
          if(encoded===null)return {slot,occupied:false};
          const source=decode(encoded);
          const save=projectAndroidNativeSave(source);
          if(save.format!=='legacy')throw new Error('The native game still has an embedded dual-slot format');
          const nativeCrc=new DataView(source.buffer,source.byteOffset,source.byteLength).getInt32(24,true);
          return {slot,occupied:true,virtualSave:save.profiles[0].virtualSave,nativeCrc};
        });
        return {available:true,format:'brisk-dex-managed',activeSlot:reply.activeSlot,profiles};
      }catch(error){
        return {available:false,reason:'Android native save validation or migration failed: '+error.message};
      }
    },
    async updateNativeGameProfile(slot,bytes,expectedCrc){
      if(!Number.isInteger(slot)||slot<0||slot>1||
         !(bytes instanceof Uint8Array)||bytes.length!==131072||
         !Number.isInteger(expectedCrc))
        return {ok:false,error:'Invalid Android native save edit.'};
      const result=await native.updateProfile({slot,flash:encode(bytes),expectedCrc});
      return result&&result.ok?{...result,crc:result.crc|0}:result;
    },
    async selectNativeGameSlot(slot){
      if(!Number.isInteger(slot)||slot<0||slot>1)
        return {ok:false,error:'Select Brisk Dex save slot 1 or 2.'};
      return native.selectSlot({slot});
    },
    async backupNativeSaves(){return native.backup();},
    async restoreNativeSaves(){return native.restore();},
    async exportNativeDiagnostics(){
      let status;
      try{status=await native.status();}
      catch(error){status={status:'unavailable',message:String(error)};}
      return {ok:true,diagnostic:lastDiagnostic||{
        format:'brisk-native-diagnostic',version:1,platform:'android',
        at:new Date().toISOString(),reason:status.status==='ready'?'No failure recorded':'Native engine unavailable',
        frames,frameErrors,blackFrames,uptimeMs:startedAt?Date.now()-startedAt:0,
        engineStatus:status.status,engineMessage:String(status.message||'').slice(0,500)
      }};
    },
    async appReady(){return {ok:true};}
  };
  document.documentElement.classList.add('brisk-android-native');
  window.briskDexAPI=api;
  return api;
}
