const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

let mainWindow;
let openedSavePath=null;
const {translateText}=require('./translation-service');
ipcMain.handle('translate-text',(_,text,language)=>translateText(text,language));
function lastSavePath(){return path.join(app.getPath('userData'),'briskdex-last-save.json');}
async function rememberSave(filePath){openedSavePath=filePath;await writeFileAtomically(lastSavePath(),JSON.stringify({filePath}));}
ipcMain.handle('load-last-sav',async()=>{
 try{const {filePath}=JSON.parse(await fs.readFile(lastSavePath(),'utf8'));const buffer=await fs.readFile(filePath);openedSavePath=filePath;return {filePath,buffer:new Uint8Array(buffer)};}
 catch(e){if(e.code==='ENOENT')return null;return {error:e.message};}
});

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0b0b0c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function storagePath(){
  return path.join(app.getPath('userData'), 'briskdex-storage.json');
}

async function writeFileAtomically(filePath, data){
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try{
    await fs.writeFile(temporaryPath, data, { flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  }catch(err){
    try{ await fs.unlink(temporaryPath); }catch(_){}
    throw err;
  }
}

/* ---- Open a .sav or .srm file via native dialog, return its path + raw bytes ---- */
ipcMain.handle('open-sav', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a Brisk Emerald save file',
    filters: [{ name: 'Game Boy Advance Save', extensions: ['sav', 'srm'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const buffer = await fs.readFile(filePath);
  await rememberSave(filePath);
  return { filePath, buffer: new Uint8Array(buffer) };
});

/* ---- Write modified save bytes back to disk, keeping a timestamped backup ---- */
ipcMain.handle('write-sav', async (event, filePath, bytes) => {
  try{
    if(filePath!==openedSavePath)throw new Error('Open this save before writing it.');
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = path.extname(filePath) || '.sav';
    const backupPath = path.join(dir, `${base}.backup-${stamp}${ext}`);
    if (fsSync.existsSync(filePath)){
      await fs.copyFile(filePath, backupPath);
    }
    await writeFileAtomically(filePath, Buffer.from(bytes));
    return { ok: true, backupPath };
  }catch(err){
    return { ok: false, error: err.message };
  }
});

/* ---- External storage persisted as a JSON file outside the app bundle ---- */
ipcMain.handle('load-storage', async () => {
  try{
    const raw = await fs.readFile(storagePath(), 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('External storage file is not a Pokémon list.');
    return data;
  }catch(err){
    if (err.code === 'ENOENT') return [];
    throw err;
  }
});

ipcMain.handle('save-storage', async (event, data) => {
  try{
    if (!Array.isArray(data)) throw new Error('Storage data must be a list.');
    for (const entry of data){
      if (!entry || typeof entry.id !== 'string' || typeof entry.raw80 !== 'string'){
        throw new Error('Storage contains an invalid Pokémon record.');
      }
      const raw = Buffer.from(entry.raw80, 'base64');
      if (raw.length !== 80) throw new Error('A Pokémon record must contain exactly 80 bytes.');
    }
    await writeFileAtomically(storagePath(), JSON.stringify(data));
    return { ok: true };
  }catch(err){
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('load-game-data', async () => {
  const raw = await fs.readFile(path.join(__dirname, 'brisk-dex-data.json'), 'utf8');
  return JSON.parse(raw);
});

ipcMain.handle('load-trainer-data', async () => {
  const raw = await fs.readFile(path.join(__dirname, 'brisk-dex-trainer-teams.json'), 'utf8');
  return JSON.parse(raw);
});

ipcMain.handle('load-bundled-icons', async () => {
  const folderPath = path.join(__dirname, 'brisk-dex-icons');
  const icons = {};
  const shinyIcons = {};
  for (const entry of await fs.readdir(folderPath, { withFileTypes: true })){
    if (!entry.isFile() || !/^\d+(?:_shiny)?\.png$/i.test(entry.name)) continue;
    const data = await fs.readFile(path.join(folderPath, entry.name));
    const match = entry.name.match(/^(\d+)(_shiny)?\.png$/i);
    const target = match[2] ? shinyIcons : icons;
    target[match[1]] = `data:image/png;base64,${data.toString('base64')}`;
  }
  return { icons, shinyIcons };
});

/* ---- Load a folder of icon images. Supports two layouts:
   1) flat: <folder>/<speciesId>.png   (output of tools/extract_data.py)
   2) source tree: <folder>/<name>/icon.png (a graphics/pokemon checkout) --
      in this case we key by folder name; the renderer matches names to ids. */
ipcMain.handle('open-icon-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an icon folder (brisk-dex-icons, or graphics/pokemon)',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folderPath = result.filePaths[0];
  const icons = {};
  const shinyIcons = {};

  const toDataUrl = async (filePath) => {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.gif' ? 'image/gif' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  };

  const walk = async (dir) => {
    const rel = path.relative(folderPath, dir).split(path.sep).join('').replace(/[_-]/g, '').toLowerCase();
    for (const entry of await fs.readdir(dir, { withFileTypes: true })){
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile()){
        const numeric = entry.name.match(/^(\d+)(_shiny)?\.(png|gif|jpg|jpeg)$/i);
        const nameMatch = entry.name.match(/^icon(_shiny)?\.png$/i);
        if (numeric){
          const target = numeric[2] ? shinyIcons : icons;
          target[numeric[1]] = await toDataUrl(filePath);
        } else if (nameMatch && rel){
          const target = nameMatch[1] ? shinyIcons : icons;
          target['name:' + rel] = await toDataUrl(filePath);
        }
      }
    }
  };
  await walk(folderPath);
  return { folderPath, icons, shinyIcons };
});


ipcMain.handle('load-asset-patch', async (_, file) => {
 if(typeof file!=='string'||!/^brisk-dex-asset-patches\/(manifest|[0-9]+|tm-[0-9]+)\.json$/.test(file))throw new Error('Invalid graphic pack');
 return fs.readFile(path.join(__dirname,file),'utf8');
});

let localBattleRelay=null;
ipcMain.handle('start-battle-relay',async()=>{
  try{
    if(!localBattleRelay)localBattleRelay=require('./battle-server');
    const address=await localBattleRelay.ready;
    const urls=[];
    for(const entries of Object.values(require('os').networkInterfaces())){
      for(const entry of entries||[])if(entry.family==='IPv4'&&!entry.internal)urls.push('http://'+entry.address+':'+address.port);
    }
    return {ok:true,url:'http://127.0.0.1:'+address.port,lanUrls:urls};
  }catch(err){return {ok:false,error:err.message};}
});
app.on('before-quit',()=>{if(localBattleRelay)localBattleRelay.server.close();});
