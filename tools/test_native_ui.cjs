const {chromium}=require(process.env.BRISK_PLAYWRIGHT_MODULE||'playwright');
const relay=require('node:child_process').spawn(process.execPath,[require('node:path').join(__dirname,'serve_native_game.mjs')],{stdio:['ignore','pipe','pipe']});
(async()=>{
 await new Promise((resolve,reject)=>{relay.stdout.once('data',resolve);relay.once('error',reject);});
 const browser=await chromium.launch({...(process.env.BRISK_CHROMIUM_PATH?{executablePath:process.env.BRISK_CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--no-zygote','--single-process']});
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 await page.goto('http://127.0.0.1:8790/game/index.html');await page.getByRole('button',{name:'Quick start',exact:true}).click();await page.getByRole('button',{name:'Treecko',exact:true}).click();await page.waitForFunction(()=>window.BriskNative?.snapshot());
 await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Journey saved'));
 if(process.env.BRISK_SCREENSHOTS)await page.screenshot({path:require('node:path').join(process.env.BRISK_SCREENSHOTS,'brisk-prototype-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Travel · dev',exact:true}).click();await page.getByRole('button',{name:'Original field station',exact:true}).click();
 const press=async(key,n=1)=>{for(let i=0;i<n;i++){await page.keyboard.press(key);await page.waitForTimeout(165);}};
 await press('ArrowUp',2);await press('ArrowLeft');await press('e');await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Journey saved'));
 await press('ArrowDown');await press('ArrowLeft',6);await press('ArrowUp',3);
 await page.waitForFunction(()=>document.getElementById('map-name').textContent==='Research Lab');
 await press('ArrowUp',4);await press('ArrowRight',2);await press('ArrowUp');await press('e');
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Options',exact:true}).click();await page.locator('label').filter({hasText:'Difficulty'}).locator('select').selectOption('easy');await page.getByRole('button',{name:'Close',exact:true}).click();await press('e');await page.getByRole('button',{name:'Linking Cord · ₽3000',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Journey saved'));await page.reload();await page.waitForFunction(()=>document.getElementById('map-name').textContent==='Research Lab');
 if(!(await page.locator('#bag').textContent()).includes('Linking Cord × 1'))throw Error('Shop save did not persist');
 await page.locator('#world').focus();await press('ArrowLeft',2);await press('ArrowDown',5);await page.waitForFunction(()=>document.getElementById('map-name').textContent==='Brisk Field Station');
 // Meet rival at 9,10, approaching from east.
 await press('ArrowDown',2);await press('ArrowRight',4);await press('ArrowDown');await press('ArrowLeft');await press('e');
 await page.getByRole('button',{name:'Battle',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('battle').hidden);
 if(process.env.BRISK_SCREENSHOTS)await page.locator('.game-screen').screenshot({path:require('node:path').join(process.env.BRISK_SCREENSHOTS,'single-battle.png')});
 if(await page.getByRole('button',{name:/Poké Ball \(/}).count())throw Error('Trainer battle shows catching');
 for(let i=0;i<60;i++){
   const done=page.getByRole('button',{name:'Return to the field',exact:true});if(await done.count()){await done.click();break;}
   await page.locator('#battle-actions button').filter({hasText:/Pound|Quick Attack|Swift|Magical Leaf|Struggle/}).filter({visible:true}).first().click();
 }
 await page.waitForFunction(()=>document.getElementById('battle').hidden);
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Journey saved'));
 const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});await mobile.goto('http://127.0.0.1:8790/game/index.html');await mobile.waitForFunction(()=>window.BriskNative?.snapshot());if(process.env.BRISK_SCREENSHOTS)await mobile.screenshot({path:require('node:path').join(process.env.BRISK_SCREENSHOTS,'brisk-prototype-mobile.png'),fullPage:true});
 if(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile page overflows');
 const enabled=await mobile.evaluate(()=>Object.entries(window.BriskNative.capabilities).some(([key,value])=>key!=='gbaImport'&&value));if(enabled)throw Error('An integration is enabled');
 const atomic=await mobile.evaluate(async()=>{
   const {ContentRecords}=await import('./storage.mjs'),records=new ContentRecords();await records.writeMany([['test-a',1],['test-b',2]]);
   try{await records.writeMany([['test-a',3],['test-b',()=>{}]]);}catch{}
   return [await records.read('test-a'),await records.read('test-b')];
 });if(JSON.stringify(atomic)!=='[1,2]')throw Error('Failed content transaction changed active records');
 await mobile.close();await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('brisk-native-campaign');request.onsuccess=resolve;request.onerror=()=>reject(request.error);}));await page.close();const storyPage=await context.newPage();
 storyPage.on('pageerror',e=>errors.push(e.message));
 const fixture=JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'../game/content.json'),'utf8'));
 fixture.start={map:'field',x:12,y:10};fixture.maps.field.scriptText='TestChoice::\n msgbox Ask, MSGBOX_YESNO\n goto_if_eq VAR_RESULT, NO, End\n giveitem ITEM_POTION, 2\nEnd::\n end\nAsk:\n .string "Accept supplies?$"';fixture.maps.field.events.push({kind:'dialogue',x:13,y:8,sourceScript:'TestChoice',text:'Supplies'});
 await storyPage.route('**/game/content.json',route=>route.fulfill({json:fixture}));
 await storyPage.goto('http://127.0.0.1:8790/game/index.html');await storyPage.getByRole('button',{name:'Quick start',exact:true}).click();await storyPage.getByRole('button',{name:'Treecko',exact:true}).click();await storyPage.waitForFunction(()=>document.getElementById('notice').textContent.includes('Journey saved'));
 for(const key of ['ArrowUp','ArrowUp','ArrowRight','e'])await storyPage.keyboard.press(key);
 await storyPage.getByRole('button',{name:'Yes',exact:true}).click();await storyPage.waitForFunction(()=>!document.getElementById('modal').open&&document.getElementById('bag').textContent.includes('Potion × 7'));
 if(!(await storyPage.locator('#bag').textContent()).includes('Potion × 7'))throw Error('Story choice did not grant exactly two Potions');
 await storyPage.keyboard.press('e');await storyPage.getByRole('button',{name:'Close',exact:true}).click();
 if(!(await storyPage.locator('#bag').textContent()).includes('Potion × 7'))throw Error('Cancelled story granted an item');
 await storyPage.close();
 const gbaPage=await context.newPage();await gbaPage.goto('http://127.0.0.1:8790/game/index.html');await gbaPage.waitForFunction(()=>window.BriskNative?.snapshot());
 const {makeGbaSave}=await import(require('node:url').pathToFileURL(require('node:path').join(__dirname,'../test/game/gba-fixture.mjs')).href);
 gbaPage.on('dialog',dialog=>dialog.accept());
 const padded=Buffer.alloc(0x40000,255);Buffer.from(makeGbaSave()).copy(padded);
 await gbaPage.locator('#gba-import').setInputFiles({name:'brisk-transfer.srm',mimeType:'application/octet-stream',buffer:padded});
 await gbaPage.getByRole('heading',{name:'GBA import report',exact:true}).waitFor();
 if(!(await gbaPage.locator('#bag').textContent()).includes('Potion × 7'))throw Error('GBA inventory did not transfer');
 const originalDownload=gbaPage.waitForEvent('download');await gbaPage.getByRole('button',{name:'Close',exact:true}).click();await gbaPage.getByRole('button',{name:'Export original GBA',exact:true}).click();
 const download=await originalDownload,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);if(!Buffer.concat(chunks).equals(padded))throw Error('Original GBA export changed bytes');
 // Exercise visible source encounters through the real native import/UI path.
 const {fresh}=await import(require('node:url').pathToFileURL(require('node:path').join(__dirname,'../test/game/helpers.mjs')).href),{encodeSave}=await import(require('node:url').pathToFileURL(require('node:path').join(__dirname,'../game/storage.mjs')).href);
 const wild=fresh();wild.state.position={map:'map_route101',x:15,y:10};wild.state.options.overworldEncounters=true;
 await gbaPage.locator('#import').setInputFiles({name:'wildlife.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(await encodeSave(wild.snapshot())))});
 await gbaPage.locator('#notice').filter({hasText:'Imported standalone campaign'}).waitFor();
 await gbaPage.getByRole('button',{name:'Options',exact:true}).click();await gbaPage.locator('label').filter({hasText:'Visible Pokémon density'}).locator('select').selectOption('9');await gbaPage.locator('label').filter({hasText:'Fast shiny hunting despawns'}).locator('select').selectOption('true');await gbaPage.getByRole('button',{name:'Close',exact:true}).click();
 await gbaPage.locator('#world').press('ArrowLeft');
 const wildDownload=gbaPage.waitForEvent('download');await gbaPage.getByRole('button',{name:'Export save',exact:true}).click();const exported=await wildDownload,ws=await exported.createReadStream(),wc=[];for await(const chunk of ws)wc.push(chunk);const state=JSON.parse(JSON.parse(Buffer.concat(wc).toString()).payload);if(!state.options.shinyHunt||state.options.wildlifeDensity!==9||state.wildlife.actors.length!==9)throw Error('Visible encounter controls did not update persisted wildlife');
 if(process.env.BRISK_SCREENSHOTS)await gbaPage.locator('#world').screenshot({path:require('node:path').join(process.env.BRISK_SCREENSHOTS,'brisk-visible-wildlife.png')});
 await gbaPage.close();
 if(errors.length)throw Error(errors.join('\n'));console.log('Browser checks passed: starter, movement, healing, lab warp, Linking Cord purchase, persistence, trainer battle, mobile layout, disabled integrations, atomic content transaction rollback.');await browser.close();relay.kill();
})().catch(e=>{console.error(e);relay.kill();process.exit(1);});
