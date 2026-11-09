const fs=require('fs');
const path=require('path');

function fail(message){throw new Error(message);}
function exists(p){if(!fs.existsSync(p))fail('Missing release file: '+p);}
function read(p){exists(p);return fs.readFileSync(p,'utf8');}
function json(p){try{return JSON.parse(read(p));}catch(e){fail('Invalid JSON in '+p+': '+e.message);}}
function check(condition,message){if(!condition)fail(message);}

const pkg=json('package.json');
const requiredRoot=[
  'index.html','main.js','preload.js','asset-loader.js','localization.js',
  'emerald-compat.js','gba-rom-import.js','classic-rom-import.js','github-rom-source.js','rom-compat-audit.js','brisk-dex-data.json','brisk-dex-trainer-teams.json',
  'brisk-dex-icon-manifest.json','compatibility/README.md',
  'compatibility/emerald-compat-profile.schema.json','compatibility/example-expansion-pack.json'
];
requiredRoot.forEach(exists);

const packaged=new Set(pkg.build&&pkg.build.files||[]);
check(packaged.has('emerald-compat.js'),'Electron package does not include emerald-compat.js');
check(packaged.has('gba-rom-import.js'),'Electron package does not include gba-rom-import.js');
check(packaged.has('classic-rom-import.js'),'Electron package does not include classic-rom-import.js');
check(packaged.has('github-rom-source.js'),'Electron package does not include the GitHub ROM link importer');
check(packaged.has('compatibility/**/*'),'Electron package does not include compatibility packs/docs');

const html=read('index.html');
check(pkg.productName==='Adapt Dex','Adapt Dex build branding is missing');
check(html.includes('<title>Adapt Dex</title>'),'Adapt Dex page title is missing');
check(html.includes('--accent:#ffd22b;'),'Adapt Dex yellow theme token is missing');
check(html.includes('<script src="emerald-compat.js"></script>'),'index.html does not load emerald-compat.js');
check(html.includes('setting-emerald-profile'),'Compatibility profile UI is missing');
check(html.includes('assertSaveWritable'),'Save write safety guard is missing');
check(html.includes('validateSaveForWrite'),'Round-trip save validation is missing');
check(html.includes('id="compat-launch"'),'ROM-first launch dialog is missing');
check(html.includes('id="launch-rom-file"'),'Required ROM selector is missing');
check(html.includes('id="launch-save-file"'),'Optional save selector is missing');
check(html.includes('id="launch-enter"'),'Enter Adapt Dex launch action is missing');
check(html.includes('openCompatLaunchSession'),'ROM-first session loading is missing');
for(const removed of ['tab-competitive','tab-online','tab-trading','competitive-tab-panel','online-tab-panel','trading-tab-panel']){
  check(!html.includes('id="'+removed+'"'),'Removed compatibility screen still exists: '+removed);
}
for(const removedName of ['function renderCompetitiveSets(','function renderOnlineBattle(','function renderTrading(','function wonderTradeAtLocation(']){
  check(!html.includes(removedName),'Removed app feature is still bundled: '+removedName);
}
check(!packaged.has('battle-server.js'),'The removed online battle relay must not be packaged');
check(!pkg.scripts['battle-server'],'The removed battle relay must not be a release script');
check(html.includes('rom-compat-audit.js'),'The ROM/save audit is missing from app scripts');
check(html.includes('recordObservedRomPair'),'ROM/save pairing persistence is missing');
check(html.includes('id="btn-clear-rom-pair"'),'ROM/save pairing reset is missing');
check(read('gba-rom-import.js').includes('verifyIndexedSource'),'Indexed ROM integrity check is missing');
check(read('tools/embed_rom_index.py').includes('portable_art'),'Python indexer must embed portable Fakemon art and cries');
check(html.includes('auditAndBindSave'),'ROM save mismatch write protection is missing');

check(html.includes('await handleGbaRomFile(compatLaunchRom)'),'Launch must load selected ROM before opening the app');
check(html.includes("setMainTab(currentSave?'save':'dex')"),'ROM-only or classic SRAM inspection must open the Pokedex');
check(!/^[^\n]*restoreLastSave\(\);\s*$/m.test(html),'Compat launch must not automatically restore a previously opened save');

check(html.includes('<script src="gba-rom-import.js"></script>'),'index.html does not load gba-rom-import.js');
check(html.includes('<script src="classic-rom-import.js"></script>'),'index.html does not load the GB/GBC importer');
check(html.includes('<script src="github-rom-source.js"></script>'),'index.html does not load the GitHub link importer');
check(html.includes('id="launch-github-url"'),'GitHub URL input is missing');
check(html.includes('id="launch-load-github"'),'GitHub link load action is missing');
new Function(read('github-rom-source.js'));
new Function(read('classic-rom-import.js'));
new Function(read('gba-rom-import.js'));
check(html.includes('<script src="rom-compat-audit.js"></script>'),'ROM audit module not loaded');
check(packaged.has('rom-compat-audit.js'),'Electron build missing ROM audit module');
new Function(read('rom-compat-audit.js'));
const compat=read('emerald-compat.js');
new Function(compat);
const inlineStart=html.lastIndexOf('<script>');
const inlineEnd=html.indexOf('</script>',inlineStart);
check(inlineStart>=0&&inlineEnd>inlineStart,'Could not locate main inline application script');
new Function(html.slice(inlineStart+8,inlineEnd));

json('brisk-dex-data.json');
json('brisk-dex-trainer-teams.json');
json('brisk-dex-icon-manifest.json');
json('compatibility/emerald-compat-profile.schema.json');
json('compatibility/example-expansion-pack.json');

const prep=read('tools/prepare_android.mjs');
check(prep.includes("'emerald-compat.js'"),'Mobile bundle does not copy emerald-compat.js');
check(prep.includes("'gba-rom-import.js'"),'Mobile bundle does not copy gba-rom-import.js');
check(prep.includes("'classic-rom-import.js'"),'Mobile bundle does not copy classic-rom-import.js');
check(prep.includes("'github-rom-source.js'"),'Mobile bundle does not copy GitHub link importer');
check(prep.includes("'compatibility'"),'Mobile bundle does not copy compatibility directory');

if(process.argv.includes('--mobile')){
  exists('www/index.html');
  exists('www/emerald-compat.js');
  exists('www/gba-rom-import.js');
  exists('www/classic-rom-import.js');
  exists('www/github-rom-source.js');
  exists('www/rom-compat-audit.js');
  exists('www/compatibility/emerald-compat-profile.schema.json');
  const mobileHtml=read('www/index.html');
  check(mobileHtml.includes('<script src="emerald-compat.js"></script>'),'Prepared mobile index lost emerald-compat.js');
  check(mobileHtml.includes('<script src="android-bridge.js"></script>'),'Prepared mobile index lost native bridge');
}

console.log('Release verification passed.');
