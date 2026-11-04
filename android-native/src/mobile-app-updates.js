// APK updates are separate from the embedded native game's SDL/JNI bridge.
// Android's system installer still requires the player's approval.
export function installAndroidAppUpdates({Capacitor,registerPlugin}){
  if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android')return null;
  const updater=registerPlugin('BriskAppUpdater');
  const key='briskdex_android_auto_updates';
  let automatic=localStorage.getItem(key)!=='false';
  const api=window.briskDexAPI || {};
  Object.assign(api,{
    async updateStatus(){
      const state=await updater.status();
      return {automatic,current:state.version||'Android',pending:state.pending||null,
        canRollback:false,busy:!!state.busy,versionCode:state.versionCode};
    },
    async checkForUpdates(){
      return await updater.check()||{ok:false,message:'Android updater did not respond.'};
    },
    async automaticUpdates(enabled){
      automatic=Boolean(enabled);
      localStorage.setItem(key,String(automatic));
      return automatic?api.checkForUpdates():{ok:true,message:'Automatic APK checks are disabled.'};
    },
    async applyUpdate(){
      if(typeof api.getNativeGameStatus==='function'){
        const status=await api.getNativeGameStatus().catch(()=>null);
        if(status?.running)return {ok:false,message:'Save and stop the integrated game before installing an update.'};
      }
      const result=await updater.install();
      if(result?.needsPermission)await updater.openInstallSettings();
      return result;
    },
    async rollbackUpdate(){
      return {ok:false,message:'Android APK downgrades are not supported.'};
    }
  });
  window.briskDexAPI=api;
  if(automatic){
    window.addEventListener('DOMContentLoaded',()=>{
      api.checkForUpdates().then(result=>{
        const status=document.getElementById('native-update-status');
        if(status&&result?.message)status.textContent=result.message;
        if(result?.pending){
          const button=document.getElementById('native-update-apply');
          if(button)button.disabled=false;
        }
      }).catch(error=>console.warn('Android auto-update check failed:',error));
    },{once:true});
  }
  return api;
}
