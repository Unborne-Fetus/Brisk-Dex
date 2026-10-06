const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('briskDexAPI', {
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

