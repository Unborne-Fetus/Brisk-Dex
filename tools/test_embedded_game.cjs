const {chromium}=require(process.env.BRISK_PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process');const path=require('node:path');const {pathToFileURL}=require('node:url');
const server=spawn(process.execPath,[path.join(__dirname,'serve_browser.mjs')],{stdio:['ignore','pipe','pipe']});
(async()=>{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
  let browser;
  const {fresh,catalog}=await import(pathToFileURL(path.join(__dirname,'../test/game/helpers.mjs')).href),{encodeSave}=await import(pathToFileURL(path.join(__dirname,'../game/storage.mjs')).href);
  const c=fresh();c.state.options.encounters=false;c.state.flags.FLAG_BADGE05_GET=true;c.state.position={map:'map_route103',x:0,y:0};let shore;
  for(let y=0;y<c.map.height;y++)for(let x=0;x<c.map.width-2;x++)if(c.canOccupy(x,y,c.map,'land')&&c.tile(x,y)!=='~'&&c.canOccupy(x+1,y,c.map,'surf')&&c.canOccupy(x+2,y,c.map,'surf')&&c.tile(x+1,y)==='~'&&c.tile(x+2,y)==='~')shore={map:c.map.id,x,y};
  if(!shore)throw Error('No source shoreline for test');c.state.position=shore;const fixture=Buffer.from(JSON.stringify(await encodeSave(c.snapshot())));
  for(const [name,url]of [['web','http://127.0.0.1:8788/'],['single-file',pathToFileURL(path.join(__dirname,'../standalone/index.html')).href]]){
    browser=await chromium.launch({executablePath:process.env.BRISK_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--no-zygote','--single-process']});
    const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(url);await page.locator('#tab-game').click();const game=page.frameLocator('#brisk-game');await game.getByRole('button',{name:'Quick start',exact:true}).click();await game.getByRole('button',{name:'Treecko',exact:true}).click();
    await game.locator('#notice').filter({hasText:'Journey saved'}).waitFor();
    await game.locator('#import').setInputFiles({name:'shore.json',mimeType:'application/json',buffer:fixture});await game.locator('#notice').filter({hasText:'Imported standalone campaign'}).waitFor();
    await game.locator('#world').press('ArrowRight');await game.locator('#world').press('e');await game.getByRole('button',{name:'Yes',exact:true}).click();await game.getByRole('button',{name:'Continue',exact:true}).click();
    const frame=page.frames().find(f=>f.parentFrame());await frame.waitForFunction(()=>!document.getElementById('modal').open&&!document.getElementById('save').disabled);
    await game.getByRole('button',{name:'Save',exact:true}).click();await game.locator('#notice').filter({hasText:'Journey saved'}).waitFor();
    await page.locator('#tab-settings').click();await page.locator('#tab-game').click();
    const read=async()=>{const downloadEvent=page.waitForEvent('download');await game.getByRole('button',{name:'Export save',exact:true}).click();const download=await downloadEvent,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return JSON.parse(JSON.parse(Buffer.concat(chunks).toString()).payload);};
    if(process.env.BRISK_SCREENSHOTS)await game.locator('#world').screenshot({path:path.join(process.env.BRISK_SCREENSHOTS,'brisk-surf-'+name+'.png')});
    const state=await read();if(state.field?.mode!=='surf'||state.position.x!==shore.x+1||state.position.y!==shore.y)throw Error(name+' did not preserve the Surf action and position');
    await page.reload();await page.locator('#tab-game').click();await game.locator('#map-name').filter({hasText:'Route103'}).waitFor();const restored=await read();if(restored.field?.mode!=='surf'||restored.position.x!==state.position.x)throw Error(name+' did not restore a water save');
    if(errors.length)throw Error(name+': '+errors.join('\n'));console.log(name+': app tab, source Surf prompt, water save, tab switching and reload passed');await browser.close();
  }
  server.kill();
})().catch(e=>{console.error(e);server.kill();process.exit(1);});
