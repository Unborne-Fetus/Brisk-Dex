'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('native fullscreen includes only the game canvas, never the Dex UI controls',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','..','index.html'),'utf8');
  const match=html.match(/<div id="native-game-stage">([\s\S]*?)<\/div>/);
  assert.ok(match,'dedicated fullscreen stage exists');
  assert.match(match[1],/<canvas id="native-game-screen" width="240" height="160"/);
  assert.doesNotMatch(match[1],/native-game-(?:status|launch|stop|backup|settings)/);
  assert.match(html,/getElementById\('native-game-stage'\)\.requestFullscreen\(\)/);
  assert.doesNotMatch(html,/getElementById\('native-game-view'\)\.requestFullscreen\(\)/);
  assert.match(html,/#native-game-stage:fullscreen\s+#native-game-screen/);
  assert.match(html,/width:min\(100vw, 150vh\)/);
});
