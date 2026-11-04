#!/usr/bin/env node
'use strict';
// Verifies the Brisk Dex shell owns the game viewport. Does not need proprietary game assets.
const path=require('node:path');
const assert=require('node:assert/strict');
const { _electron: electron }=require('playwright');
(async()=>{
 const app=await electron.launch({args:[path.join(__dirname,'..')],timeout:60000});
 try{
  const page=await app.firstWindow();
  await page.locator('#game-tab-panel').waitFor({state:'visible',timeout:30000});
  const canvas=page.locator('#native-game-screen');
  assert.equal(await canvas.getAttribute('width'),'240');
  assert.equal(await canvas.getAttribute('height'),'160');
  assert.equal(await page.locator('#native-game-select').count(),0,'legacy executable picker must be absent');
  assert.equal(await page.locator('#brisk-game').count(),0,'legacy embedded remake iframe must be absent');
  await page.locator('#native-game-status').waitFor({state:'visible',timeout:20000});
  const status=await page.locator('#native-game-status').textContent();
  assert.match(status,/internal|integrated|not included|engine/i,'Native engine status should be visible regardless of capitalization');
  await page.locator('#tab-dex').click();
  await page.locator('#tab-game').click();
  assert.equal(await canvas.isVisible(),true);
  console.log('Embedded native game tab and Dex navigation verified; no external EXE selector/window.');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exit(1);});
