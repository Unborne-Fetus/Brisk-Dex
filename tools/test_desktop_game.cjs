// Test the real Electron main/preload, bundled game, secure origin and disk saves.
const {_electron}=require(process.env.BRISK_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),profile=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-desktop-')),errors=[];let app;
 try{
  app=await _electron.launch({executablePath:process.env.BRISK_ELECTRON_PATH||require('electron'),args:[...process.platform==='linux'?['--no-sandbox','--headless','--ozone-platform=headless']:[],'--disable-gpu',process.env.BRISK_APP_PATH||root],timeout:60000});
  await app.evaluate(({app},folder)=>app.setPath('userData',folder),profile);
  let page;for(let attempt=0;attempt<100;attempt++){page=app.windows().find(p=>p.url().startsWith('brisk://app/'));if(page)break;await new Promise(resolve=>setTimeout(resolve,200));}if(!page)throw Error('Desktop main window did not open');page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept().catch(()=>{}));
  if(!page.url().startsWith('brisk://app/'))throw Error('Desktop did not use the bundled app origin');
  await page.locator('#tab-game').click();const game=page.frameLocator('#brisk-game');await game.getByRole('button',{name:'New game',exact:true}).click();
  // Complete Birch's welcome, gender and name, then arrive inside the truck.
  for(let i=0;i<3;i++)await game.getByRole('button',{name:'Continue',exact:true}).click();await game.getByRole('button',{name:'Boy',exact:true}).click();await game.getByRole('textbox',{name:'What is your name?'}).fill('Spencer');await game.getByRole('button',{name:'Continue',exact:true}).click();await game.getByRole('button',{name:'Continue',exact:true}).click();
  await game.locator('#notice').filter({hasText:'Journey saved'}).waitFor();await game.locator('#map-name').filter({hasText:'Inside Of Truck'}).waitFor();
  const records=JSON.parse(await fs.readFile(path.join(profile,'brisk-emerald-campaign.json'),'utf8')),state=JSON.parse(records.current.payload);if(state.party.length||state.position.map!=='map_inside_of_truck')throw Error('New game skipped the original opening');
  await game.locator('#world').press('ArrowRight');await game.locator('#world').press('ArrowRight');
  // Source truck arrival and Mom's moving-in scene.
  for(let i=0;i<3;i++)await game.getByRole('button',{name:'Continue',exact:true}).click();
  const child=page.frames().find(f=>f.parentFrame());await child.waitForFunction(()=>!document.getElementById('modal').open&&!document.getElementById('save').disabled);
  await game.getByRole('button',{name:'Save',exact:true}).click();await game.locator('#notice').filter({hasText:'Journey saved'}).waitFor();
  const saved=JSON.parse(await fs.readFile(path.join(profile,'brisk-emerald-campaign.json'),'utf8'));if(!saved.backup||JSON.parse(saved.current.payload).vars.VAR_LITTLEROOT_INTRO_STATE!==4)throw Error('Desktop save/backup did not record moving-in progression');
  await page.locator('#tab-settings').click();await page.locator('#tab-game').click();await page.reload();await page.locator('#tab-game').click();await game.locator('#map-name').filter({hasText:'Brendans House 1F'}).waitFor();
  const secure=await page.frames().find(f=>f.parentFrame()).evaluate(()=>isSecureContext);if(!secure)throw Error('Game requires a secure context for save checksums');
  if(errors.length)throw Error(errors.join('\n'));console.log('Electron: offline bundled game, source intro, native disk save/backup, tab switching and reload passed');
 }finally{if(app)await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
