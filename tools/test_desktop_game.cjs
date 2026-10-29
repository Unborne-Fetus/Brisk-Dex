// Test the real Electron main/preload, bundled game, secure origin and disk saves.
const {_electron}=require(process.env.BRISK_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),profile=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-desktop-')),errors=[];let app;
 try{
  app=await _electron.launch({executablePath:process.env.BRISK_ELECTRON_PATH||require('electron'),args:[...process.platform==='linux'?['--no-sandbox','--headless','--ozone-platform=headless']:[],'--disable-gpu',process.env.BRISK_APP_PATH||root],timeout:60000});
  await app.evaluate(({app},folder)=>app.setPath('userData',folder),profile);
  let page;for(let attempt=0;attempt<100;attempt++){page=app.windows().find(p=>p.url().startsWith('brisk://app/'));if(page)break;await new Promise(resolve=>setTimeout(resolve,200));}if(!page)throw Error('Desktop main window did not open');page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept().catch(()=>{}));
  if(!page.url().startsWith('brisk://app/'))throw Error('Desktop did not use the bundled app origin');
  if(await page.locator('.main-tabs button').first().getAttribute('id')!=='tab-game'||await page.locator('#tab-game').getAttribute('aria-selected')!=='true')throw Error('Play Brisk Emerald must be first and selected at startup');const game=page.frameLocator('#brisk-game');await game.getByRole('button',{name:'New game',exact:true}).click();
  // Complete Birch's welcome, gender and name, then arrive inside the truck.
  // Birch's source dialogue changes as Brisk Emerald is updated. Advance
  // all intro pages rather than assuming it always takes exactly three clicks.
  for(let i=0;i<32;i++){
    if(await game.getByRole('button',{name:'Boy',exact:true}).isVisible())break;
    await game.getByRole('button',{name:'Continue',exact:true}).click();
  }
  await game.getByRole('button',{name:'Boy',exact:true}).click();await game.getByRole('textbox',{name:'What is your name?'}).fill('Spencer');await game.getByRole('button',{name:'Continue',exact:true}).click();await game.getByRole('button',{name:'Continue',exact:true}).click();
  await game.locator('#notice').filter({hasText:'Journey saved'}).waitFor();await game.locator('#map-name').filter({hasText:'Inside Of Truck'}).waitFor();
  const records=JSON.parse(await fs.readFile(path.join(profile,'brisk-emerald-campaign.json'),'utf8')),state=JSON.parse(records.current.payload);if(state.party.length||state.position.map!=='map_inside_of_truck')throw Error('New game skipped the original opening');
  await game.locator('#world').press('ArrowRight');await game.locator('#world').press('ArrowRight');
  // Source truck arrival and Mom's moving-in scene.
  if(process.env.BRISK_TRACE)console.log('Truck saved; entering moving-in scene');
  for(let i=0;i<50;i++){const frame=page.frames().find(f=>f.parentFrame());await frame.waitForFunction(()=>document.getElementById('modal').open&&document.querySelector('#modal-content button')||!document.getElementById('save').disabled,null,{timeout:20000});if(process.env.BRISK_TRACE)console.log('Scene page',i,await game.locator('#modal-content').textContent(),await game.locator('#notice').textContent());if(await game.getByRole('button',{name:'Continue',exact:true}).count())await game.getByRole('button',{name:'Continue',exact:true}).click();else break;}
  const child=page.frames().find(f=>f.parentFrame());await child.waitForFunction(()=>!document.getElementById('modal').open&&!document.getElementById('save').disabled);
  await game.getByRole('button',{name:'Save',exact:true}).click();await game.locator('#notice').filter({hasText:'Journey saved'}).waitFor();
  const saved=JSON.parse(await fs.readFile(path.join(profile,'brisk-emerald-campaign.json'),'utf8'));if(!saved.backup||JSON.parse(saved.current.payload).vars.VAR_LITTLEROOT_INTRO_STATE!==4)throw Error('Desktop save/backup did not record moving-in progression');
  await page.locator('#tab-settings').click();await page.locator('#tab-game').click();await page.reload();await page.locator('#tab-game').click();await game.locator('#map-name').filter({hasText:'Brendans House 1F'}).waitFor();
  const secure=await page.frames().find(f=>f.parentFrame()).evaluate(()=>isSecureContext);if(!secure)throw Error('Game requires a secure context for save checksums');
  const {makeGbaSave}=await import(require('node:url').pathToFileURL(path.join(root,'test/game/gba-fixture.mjs')).href),bytes=makeGbaSave({trainer:'Unborne',flags:['FLAG_SYS_POKEMON_GET','FLAG_RESCUED_BIRCH','FLAG_SYS_POKEDEX_GET','FLAG_BADGE01_GET','TRAINER_ROXANNE_1'],vars:{VAR_LITTLEROOT_INTRO_STATE:7,VAR_BIRCH_LAB_STATE:5,VAR_PETALBURG_CITY_STATE:3,VAR_PETALBURG_GYM_STATE:2}}),sourceFile=path.join(profile,'existing-brisk.sav');
  await fs.writeFile(sourceFile,bytes);await fs.writeFile(path.join(profile,'briskdex-last-save.json'),JSON.stringify({filePath:sourceFile}));
  await page.reload();await game.locator('#notice').filter({hasText:'Resumed Unborne'}).waitFor();if(await game.getByRole('button',{name:'New game',exact:true}).count())throw Error('Existing save opened a new-game prompt');
  const resumed=JSON.parse(JSON.parse(await fs.readFile(path.join(profile,'brisk-emerald-campaign.json'),'utf8')).current.payload);if(resumed.trainer.name!=='Unborne'||!resumed.flags.FLAG_BADGE01_GET||resumed.party[0].level!==12||resumed.position.map!=='map_petalburg_city')throw Error('Dex progress was not resumed');
  await game.locator('#encounters').uncheck();await game.getByRole('button',{name:'Save',exact:true}).click();await game.locator('#notice').filter({hasText:'Journey saved'}).waitFor();await page.reload();await game.locator('#notice').filter({hasText:'Resumed Unborne'}).waitFor();const preserved=JSON.parse(JSON.parse(await fs.readFile(path.join(profile,'brisk-emerald-campaign.json'),'utf8')).current.payload);if(preserved.options.encounters!==false)throw Error('Relaunch replaced newer native progress with the old GBA save');if(!Buffer.from(await fs.readFile(sourceFile)).equals(Buffer.from(bytes)))throw Error('Native play changed the source GBA save');
  if(errors.length)throw Error(errors.join('\n'));console.log('Electron: offline bundled game, source intro, native disk save/backup, tab switching, automatic Dex-save resume and reload passed');
 }finally{if(app)await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
