const fs=require('fs');
const path=require('path');

function fail(message){throw new Error(message);}
function exists(p){if(!fs.existsSync(p))fail('Missing release file: '+p);}
function read(p){exists(p);return fs.readFileSync(p,'utf8');}
function json(p){try{return JSON.parse(read(p));}catch(e){fail('Invalid JSON in '+p+': '+e.message);}}
function check(condition,message){if(!condition)fail(message);}

const pkg=json('package.json');
const requiredRoot=[
  'index.html','main.js','preload.js','battle-server.js','asset-loader.js','localization.js',
  'emerald-compat.js','gba-rom-import.js','brisk-dex-data.json','brisk-dex-trainer-teams.json',
  'brisk-dex-icon-manifest.json','compatibility/README.md',
  'compatibility/emerald-compat-profile.schema.json','compatibility/example-expansion-pack.json'
];
requiredRoot.forEach(exists);

const packaged=new Set(pkg.build&&pkg.build.files||[]);
check(packaged.has('emerald-compat.js'),'Electron package does not include emerald-compat.js');
check(packaged.has('gba-rom-import.js'),'Electron package does not include gba-rom-import.js');
check(packaged.has('compatibility/**/*'),'Electron package does not include compatibility packs/docs');

const html=read('index.html');
check(html.includes('<script src="emerald-compat.js"></script>'),'index.html does not load emerald-compat.js');
check(html.includes('setting-emerald-profile'),'Compatibility profile UI is missing');
check(html.includes('assertSaveWritable'),'Save write safety guard is missing');
check(html.includes('validateSaveForWrite'),'Round-trip save validation is missing');
check(html.includes('id="compat-launch"'),'ROM-first launch dialog is missing');
check(html.includes('id="launch-rom-file"'),'Required ROM selector is missing');
check(html.includes('id="launch-save-file"'),'Optional save selector is missing');
check(html.includes('id="launch-enter"'),'Enter Brisk Dex launch action is missing');
check(html.includes('openCompatLaunchSession'),'ROM-first session loading is missing');
check(html.includes('await handleGbaRomFile(compatLaunchRom)'),'Launch must load selected ROM before opening the app');
check(html.includes("compatLaunchSave?'save':'dex'"),'ROM-only launch must open the Pokedex');
check(!/^[^\n]*restoreLastSave\(\);\s*$/m.test(html),'Compat launch must not automatically restore a previously opened save');

check(html.includes('<script src="gba-rom-import.js"></script>'),'index.html does not load gba-rom-import.js');
new Function(read('gba-rom-import.js'));
const compat=read('emerald-compat.js');
new Function(compat);
const inlineStart=html.lastIndexOf('<script>');
const inlineEnd=html.indexOf('</script>',inlineStart);
check(inlineStart>=0&&inlineEnd>inlineStart,'Could not locate main inline application script');
new Function(html.slice(inlineStart+8,inlineEnd));

new Function(read('battle-server.js'));
json('brisk-dex-data.json');
json('brisk-dex-trainer-teams.json');
json('brisk-dex-icon-manifest.json');
json('compatibility/emerald-compat-profile.schema.json');
json('compatibility/example-expansion-pack.json');

const prep=read('tools/prepare_android.mjs');
check(prep.includes("'emerald-compat.js'"),'Mobile bundle does not copy emerald-compat.js');
check(prep.includes("'gba-rom-import.js'"),'Mobile bundle does not copy gba-rom-import.js');
check(prep.includes("'compatibility'"),'Mobile bundle does not copy compatibility directory');

if(process.argv.includes('--mobile')){
  exists('www/index.html');
  exists('www/emerald-compat.js');
  exists('www/gba-rom-import.js');
  exists('www/compatibility/emerald-compat-profile.schema.json');
  const mobileHtml=read('www/index.html');
  check(mobileHtml.includes('<script src="emerald-compat.js"></script>'),'Prepared mobile index lost emerald-compat.js');
  check(mobileHtml.includes('<script src="android-bridge.js"></script>'),'Prepared mobile index lost native bridge');
}

console.log('Release verification passed.');
