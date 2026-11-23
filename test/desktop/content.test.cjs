const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {assetPath}=require('../../desktop-content');
test('desktop origin resolves bundled Dex assets and rejects escapes',()=>{
 const root=path.resolve('/app/resources/app.asar');assert.equal(assetPath('brisk://app/brisk-dex-data.json',root),path.join(root,'brisk-dex-data.json'));assert.equal(assetPath('brisk://app/',root),path.join(root,'index.html'));
 for(const url of ['https://app/game/index.html','brisk://other/index.html','brisk://app/%2e%2e%2fsecret','brisk://app/%5csecret','brisk://app/%00secret'])assert.equal(assetPath(url,root),null);
});


test('Expert mode is visible but clearly labels source base-team previews',()=>{
 const fs=require('node:fs');
 const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
 assert.match(html,/<option value="Expert">Expert \(base preview\)<\/option>/);
 assert.match(html,/Expert: Normal base-party preview; substitutions happen in-game/);
 assert.match(html,/trainerModeDescription\(t\)/);
});
