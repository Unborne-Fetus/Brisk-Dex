const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

let mainWindow;

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

/* ---- Open a .sav file via native dialog, return its path + raw bytes ---- */
ipcMain.handle('open-sav', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a Brisk Emerald save file',
    filters: [{ name: 'Game Boy Advance Save', extensions: ['sav'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const buffer = await fs.readFile(filePath);
  return { filePath, buffer: new Uint8Array(buffer) };
});

/* ---- Write modified save bytes back to disk, keeping a timestamped backup ---- */
ipcMain.handle('write-sav', async (event, filePath, bytes) => {
  try{
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(dir, `${base}.backup-${stamp}.sav`);
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
