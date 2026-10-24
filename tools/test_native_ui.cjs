const {chromium}=require(process.env.BRISK_PLAYWRIGHT_MODULE||'playwright');
const relay=require('node:child_process').spawn(process.execPath,[require('node:path').join(__dirname,'serve_native_game.mjs')],{stdio:['ignore','pipe','pipe']});
(async()=>{
 await new Promise((resolve,reject)=>{relay.stdout.once('data',resolve);relay.once('error',reject);});
 const browser=await chromium.launch({...(process.env.BRISK_CHROMIUM_PATH?{executablePath:process.env.BRISK_CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--no-zygote','--single-process']});
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 await page.goto('http://127.0.0.1:8790/game/index.html');await page.getByRole('button',{name:'Treecko',exact:true}).click();await page.waitForFunction(()=>window.BriskNative?.snapshot());
 await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Journey saved'));
 if(process.env.BRISK_SCREENSHOTS)await page.screenshot({path:require('node:path').join(process.env.BRISK_SCREENSHOTS,'brisk-prototype-desktop.png'),fullPage:true});
 const press=async(key,n=1)=>{for(let i=0;i<n;i++)await page.keyboard.press(key);};
 await press('ArrowUp',2);await press('ArrowLeft');await press('e');await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Journey saved'));
 await press('ArrowDown');await press('ArrowLeft',6);await press('ArrowUp',3);
 await page.waitForFunction(()=>document.getElementById('map-name').textContent==='Research Lab');
 await press('ArrowUp',4);await press('ArrowRight',2);await press('ArrowUp');await press('e');
 await page.getByRole('button',{name:'Linking Cord · ₽3000',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Journey saved'));await page.reload();await page.waitForFunction(()=>document.getElementById('map-name').textContent==='Research Lab');
 if(!(await page.locator('#bag').textContent()).includes('Linking Cord × 1'))throw Error('Shop save did not persist');
 await page.locator('#world').focus();await press('ArrowLeft',2);await press('ArrowDown',5);await page.waitForFunction(()=>document.getElementById('map-name').textContent==='Brisk Field Station');
 // Meet rival at 9,10, approaching from east.
 await press('ArrowDown',2);await press('ArrowRight',4);await press('ArrowDown');await press('ArrowLeft');await press('e');
 await page.getByRole('button',{name:'Battle',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('battle').hidden);
 if(await page.getByRole('button',{name:/Poké Ball \(/}).count())throw Error('Trainer battle shows catching');
 for(let i=0;i<60;i++){
   const done=page.getByRole('button',{name:'Return to the field',exact:true});if(await done.count()){await done.click();break;}
   await page.locator('#battle-actions button').filter({hasText:/Pound|Quick Attack|Swift|Magical Leaf|Struggle/}).filter({visible:true}).first().click();
 }
 await page.waitForFunction(()=>document.getElementById('battle').hidden);
 const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});await mobile.goto('http://127.0.0.1:8790/game/index.html');await mobile.waitForFunction(()=>window.BriskNative?.snapshot());if(process.env.BRISK_SCREENSHOTS)await mobile.screenshot({path:require('node:path').join(process.env.BRISK_SCREENSHOTS,'brisk-prototype-mobile.png'),fullPage:true});
 if(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile page overflows');
 const enabled=await mobile.evaluate(()=>Object.values(window.BriskNative.capabilities).some(Boolean));if(enabled)throw Error('An integration is enabled');
 const atomic=await mobile.evaluate(async()=>{
   const {ContentRecords}=await import('./storage.mjs'),records=new ContentRecords();await records.writeMany([['test-a',1],['test-b',2]]);
   try{await records.writeMany([['test-a',3],['test-b',()=>{}]]);}catch{}
   return [await records.read('test-a'),await records.read('test-b')];
 });if(JSON.stringify(atomic)!=='[1,2]')throw Error('Failed content transaction changed active records');
 if(errors.length)throw Error(errors.join('\n'));console.log('Browser checks passed: starter, movement, healing, lab warp, Linking Cord purchase, persistence, trainer battle, mobile layout, disabled integrations, atomic content transaction rollback.');await browser.close();relay.kill();
})().catch(e=>{console.error(e);relay.kill();process.exit(1);});
