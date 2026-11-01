'use strict';
// Browser shell regression with a mock native bridge; requires no game assets.
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..');
  const server=http.createServer(async(req,res)=>{
    try{
      const name=new URL(req.url,'http://localhost').pathname;
      const file=path.resolve(root,'.'+decodeURIComponent(name==='/'?'/index.html':name));
      if(!file.startsWith(root+path.sep))throw new Error('Invalid path');
      res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
      res.end(await fs.readFile(file));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Renderer error:',error.message);});
    await page.addInitScript(()=>{
      window.testKeys=[];window.testPad=null;window.testTransfers=[];window.testOptions=[];
      Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});
      window.briskDexAPI={
        loadGameData:async()=>(await fetch('brisk-dex-data.json')).json(),
        loadTrainerData:async()=>(await fetch('brisk-dex-trainer-teams.json')).json(),
        loadBundledIcons:async()=>(await fetch('brisk-dex-icon-manifest.json')).json(),
        loadStorage:async()=>[],saveStorage:async()=>({ok:true}),loadLastSav:async()=>null,
        configureNativeGame:async options=>{window.testOptions.push(options);return {ok:true};},
        getNativeGameStatus:async()=>({status:'ready',profile:'brisk',message:'Integrated Brisk Emerald is ready.'}),
        onNativeFrame:()=>{},onNativeState:callback=>window.testNativeState=callback,
        startNativeGame:async()=>{window.testNativeState({running:true});return {ok:true};},
        stopNativeGame:async()=>{window.testNativeState({running:false});return {ok:true};},
        sendNativeKeys:mask=>window.testKeys.push(mask),
        backupNativeSaves:async()=>{window.testTransfers.push('backup');return {ok:true,message:'Backed up.'};},
        restoreNativeSaves:async()=>{window.testTransfers.push('restore');return {ok:true,message:'Restored.'};}
      };
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>window.BriskNativeUI&&document.querySelectorAll('#native-binding-list button').length===10);
    await page.locator('#native-game-launch').click();
    assert.equal(await page.locator('#native-game-backup').isDisabled(),true);
    await page.keyboard.down('z');
    await page.evaluate(()=>{window.testPad={connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===0||i===15}))};});
    await page.waitForFunction(()=>window.testKeys.at(-1)===17);
    await page.keyboard.up('z');
    assert.equal(await page.evaluate(()=>window.testKeys.at(-1)),17);
    await page.evaluate(()=>window.testPad=null);
    await page.waitForFunction(()=>window.testKeys.at(-1)===0);
    await page.keyboard.down('ArrowUp');
    await page.locator('#tab-dex').click();
    assert.equal(await page.evaluate(()=>window.testKeys.at(-1)),0);
    await page.keyboard.up('ArrowUp');
    await page.locator('#tab-game').click();
    await page.locator('#native-game-fullscreen').click();
    await page.waitForFunction(()=>document.fullscreenElement?.id==='native-game-stage');
    // Only the canvas is fullscreen; page controls are intentionally hidden.
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.fullscreenElement);
    await page.locator('#native-game-settings summary').click();
    await page.getByRole('button',{name:'Remap A keyboard key',exact:true}).click();
    await page.keyboard.press('c');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('brisk-native-controls')).keys.KeyC),0);
    await page.locator('#native-speed').selectOption('3');
    await page.waitForFunction(()=>window.testOptions.at(-1)?.speed===3);
    await page.locator('#native-game-settings summary').click();
    await page.locator('#native-game-screen').click();
    await page.keyboard.down('c');
    await page.waitForFunction(()=>window.testKeys.at(-1)===1);
    await page.keyboard.up('c');
    await page.keyboard.down('Tab');
    await page.waitForFunction(()=>window.testOptions.at(-1)?.speed===4);
    await page.keyboard.up('Tab');
    await page.waitForFunction(()=>window.testOptions.at(-1)?.speed===3);
    await page.locator('#native-game-pause').click();
    await page.waitForFunction(()=>window.testOptions.at(-1)?.paused===true);
    await page.locator('#native-game-pause').click();
    await page.waitForFunction(()=>window.testOptions.at(-1)?.paused===false);
    await page.locator('#native-game-stop').click();
    await page.locator('#native-game-backup').click();
    await page.locator('#native-game-restore').click();
    assert.deepEqual(await page.evaluate(()=>window.testTransfers),['backup','restore']);
    assert.deepEqual(errors,[]);
    console.log('Native UI: controller/keyboard handoff, disconnect, tab release, fullscreen and backup/restore controls passed.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
