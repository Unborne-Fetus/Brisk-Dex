const fs = require('node:fs/promises');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
  const context = {
    window: {}, document: {body:{}, querySelectorAll:()=>[]},
    MutationObserver: class {observe(){}}, Blob, Response, DecompressionStream,
    Uint8Array, atob, console,
    fetch: async path => new Response(await fs.readFile(path)),
  };
  vm.runInNewContext(await fs.readFile('asset-loader.js','utf8'),context);
  for (const file of ['brisk-dex-icons/1652.png','brisk-dex-sprites/1642_front.png', 'brisk-dex-sprites/1683_front_shiny.png']) {
    const url=await context.window.BriskAssets.resolve(file);
    assert.ok(url.startsWith('data:image/png;base64,'),file);
    assert.equal(Buffer.from(url.split(',')[1],'base64').readUInt32BE(0),0x89504e47);
  }
  assert.equal(await context.window.BriskAssets.resolve('unrelated/image.png'),null);
  console.log('Lazy graphic packs resolve new icons, native sprites and shinies.');
})().catch(error=>{console.error(error);process.exitCode=1;});
