const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('briskDexAPI', {
  getNativeGameStatus:()=>ipcRenderer.invoke('native-game-status'),
  startNativeGame:()=>ipcRenderer.invoke('native-game-start'),
  stopNativeGame:()=>ipcRenderer.invoke('native-game-stop'),
  sendNativeKeys:mask=>{if(Number.isInteger(mask)&&mask>=0&&mask<=1023)ipcRenderer.send('native-game-input',mask);},
  onNativeFrame:callback=>{
    const listener=(_,pixels)=>callback(pixels);
    ipcRenderer.on('native-game-frame',listener);
    return ()=>ipcRenderer.removeListener('native-game-frame',listener);
  },
  onNativeState:callback=>{
    const listener=(_,state)=>callback(state);
    ipcRenderer.on('native-game-state',listener);
    return ()=>ipcRenderer.removeListener('native-game-state',listener);
  },
  getBattleRelayInfo: () => ipcRenderer.invoke('get-battle-relay-info'),
  startBattleRelay: () => ipcRenderer.invoke('start-battle-relay'),
  loadAssetPatch: (file) => ipcRenderer.invoke('load-asset-patch',file),
  loadLastSav: () => ipcRenderer.invoke('load-last-sav'),
  translateText: (text, language) => ipcRenderer.invoke('translate-text',text,language),
  openSavDialog: () => ipcRenderer.invoke('open-sav'),
  writeSav: (filePath, bytes) => ipcRenderer.invoke('write-sav', filePath, bytes),
  loadStorage: () => ipcRenderer.invoke('load-storage'),
  saveStorage: (data) => ipcRenderer.invoke('save-storage', data),
  loadGameData: () => ipcRenderer.invoke('load-game-data'),
  loadTrainerData: () => ipcRenderer.invoke('load-trainer-data'),
  loadBundledIcons: () => ipcRenderer.invoke('load-bundled-icons'),
  openIconFolderDialog: () => ipcRenderer.invoke('open-icon-folder')
});

