// Give each CI APK a monotonically increasing Android versionCode.
// A new APK cannot replace an installed one if its versionCode goes backwards.
import fs from 'node:fs/promises';
import path from 'node:path';
const run=Number(process.argv[2]);
if(!Number.isSafeInteger(run)||run<1||run>1000000)
  throw new Error('Expected a positive GitHub Android workflow run number.');
// Keep update-channel APK versions above the historical 1.3.x series.
// Android versionCode must stay below Google Play's 2,100,000,000 maximum.
const code=200000000+run;
const root=process.cwd();
const config=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const base=String(config.version||'1.0.0');
const versionName=base+'.'+run;
const file=path.join(root,'android','app','build.gradle');
let gradle=await fs.readFile(file,'utf8');
const codePattern=/\bversionCode\s+\d+/;
const namePattern=/\bversionName\s+["'][^"']+["']/;
if(!codePattern.test(gradle)||!namePattern.test(gradle))
  throw new Error('Android defaultConfig versionCode/versionName not found.');
gradle=gradle.replace(codePattern,'versionCode '+code)
  .replace(namePattern,'versionName "'+versionName+'"');
await fs.writeFile(file,gradle);
await fs.writeFile(path.join(root,'android-build-version.json'),
  JSON.stringify({packageName:'com.briskemerald.briskdex',versionCode:code,versionName},null,2)+'\n');
console.log('Android APK version: '+versionName+' (versionCode '+code+')');
