'use strict';
const {app,dialog,protocol}=require('electron'),path=require('node:path');
protocol.registerSchemesAsPrivileged([{scheme:'brisk',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
// Preserve the original installed application's data through the rename.
app.setPath('userData',path.join(app.getPath('appData'),'Brisk Dex'));
app.setName('Pokemon Brisk Emerald');
const {resolveActiveRoot}=require('./native-updater');
resolveActiveRoot(app.getPath('userData'),__dirname).then(root=>{
  process.env.BRISK_BUNDLED_ROOT=__dirname;
  require(path.join(root,'main.js'));
}).catch(error=>{dialog.showErrorBox('Pokemon Brisk Emerald',error.message);app.quit();});
