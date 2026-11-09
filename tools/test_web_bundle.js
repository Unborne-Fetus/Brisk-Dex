'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve('web-dist');
const exists=p=>fs.existsSync(path.join(dir,p));
const read=p=>fs.readFileSync(path.join(dir,p),'utf8');
assert(exists('index.html'),'Web entry point is missing');
const html=read('index.html');
assert(html.includes('<title>Adapt Dex</title>'),'Web branding is missing');
assert(html.includes('id="compat-launch"'),'ROM chooser is missing');
assert(html.includes('id="launch-save-file"'),'Optional save input is missing');
assert(!html.includes('<script src="android-bridge.js"></script>'),'Android native bridge was accidentally included');
for(const match of html.matchAll(/<script\s+src="([^"]+)"/g)){
  assert(exists(match[1]),'Browser script is missing: '+match[1]);
}
for(const name of ['gba-rom-import.js','classic-rom-import.js','github-rom-source.js','emerald-compat.js','rom-compat-audit.js']){
  assert(exists(name),'ROM/save importer is missing: '+name);
  new Function(read(name));
}
for(const name of ['brisk-dex-data.json','brisk-dex-trainer-teams.json','brisk-dex-icon-manifest.json']){
  assert(exists(name),'Web metadata is missing: '+name);
  JSON.parse(read(name));
}
for(const name of ['brisk-dex-icons','brisk-dex-sprites','brisk-dex-cries']){
  assert(fs.statSync(path.join(dir,name)).isDirectory(),'Artwork directory is missing: '+name);
}
assert(exists('.nojekyll'),'GitHub Pages Jekyll bypass is missing');
assert(!exists('main.js'),'Native Electron process must not be published as web content');
console.log('Adapt Dex standalone web distribution validated.');
