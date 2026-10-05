const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('briskDexAPI', {
  openSavDialog: () => ipcRenderer.invoke('open-sav'),
  writeSav: (filePath, bytes) => ipcRenderer.invoke('write-sav', filePath, bytes),
  loadStorage: () => ipcRenderer.invoke('load-storage'),
  saveStorage: (data) => ipcRenderer.invoke('save-storage', data),
  loadGameData: () => ipcRenderer.invoke('load-game-data'),
  loadTrainerData: () => ipcRenderer.invoke('load-trainer-data'),
  loadBundledIcons: () => ipcRenderer.invoke('load-bundled-icons'),
  openIconFolderDialog: () => ipcRenderer.invoke('open-icon-folder')
});
