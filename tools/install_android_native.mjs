// Add Android JNI/game transport and signed APK installer to the Capacitor project.
// This augments the existing file picker without discarding its local edits.
import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const javaDir=path.join(root,'android','app','src','main','java','com','briskemerald','briskdex');
const activityFile=path.join(javaDir,'MainActivity.java');
let activity=await fs.readFile(activityFile,'utf8');
for (const name of ['BriskNativeGamePlugin','BriskAppUpdaterPlugin']) {
  const line='registerPlugin('+name+'.class);';
  if (!activity.includes(line)) {
    const anchor='registerPlugin(SaveFilePickerPlugin.class);';
    if (!activity.includes(anchor)) throw new Error('Capacitor native Activity registration anchor missing');
    activity=activity.replace(anchor,anchor+'\n        '+line);
  }
}
await fs.writeFile(activityFile,activity);
const pin=JSON.parse(await fs.readFile(path.join(root,'tools','brisk-native-source.json'),'utf8'));
if(!/^[a-f0-9]{40}$/.test(pin.brisk_commit))throw new Error('Invalid Brisk source pin');
const template=await fs.readFile(path.join(root,'android-native','java','BriskNativeGamePlugin.java'),'utf8');
if(!template.includes('__BRISK_SOURCE_COMMIT__'))throw new Error('Native source pin placeholder missing');
await fs.writeFile(path.join(javaDir,'BriskNativeGamePlugin.java'),
  template.replace('__BRISK_SOURCE_COMMIT__',pin.brisk_commit));
for(const name of ['BriskAndroidSaveStore','BriskAndroidSaveSlots','BriskAppUpdaterPlugin']){
  await fs.copyFile(path.join(root,'android-native','java',name+'.java'),path.join(javaDir,name+'.java'));
}

const gradleFile=path.join(root,'android','app','build.gradle');
let gradle=await fs.readFile(gradleFile,'utf8');
if(!gradle.includes('externalNativeBuild {')){
  const config=[
    'android {',
    '    ndkVersion "27.2.12479018"',
    '    externalNativeBuild {',
    '        cmake {',
    '            path file("../../android-native/CMakeLists.txt")',
    '            version "3.22.1"',
    '        }',
    '    }'
  ].join('\n');
  if(!gradle.includes('android {'))throw new Error('Missing Android build configuration');
  gradle=gradle.replace('android {',config);
}
const archive=process.env.BRISK_ANDROID_GAME_ARCHIVE
  ?path.resolve(process.env.BRISK_ANDROID_GAME_ARCHIVE):null;
const source=process.env.BRISK_ANDROID_SDL2_SOURCE
  ?path.resolve(process.env.BRISK_ANDROID_SDL2_SOURCE):null;
const library=process.env.BRISK_ANDROID_SDL2_LIBRARY
  ?path.resolve(process.env.BRISK_ANDROID_SDL2_LIBRARY):null;
if(archive){
  if(path.extname(archive)!=='.a'||!(await fs.stat(archive)).isFile())
    throw new Error('A complete Android ARM64 game archive is required');
  if(Boolean(source)===Boolean(library))
    throw new Error('Specify exactly one Android SDL2 dependency for the full game');
  if(!gradle.includes('BRISK_NATIVE_ANDROID_ARCHIVE')){
    const args=[
      '-DBRISK_NATIVE_ANDROID_ARCHIVE='+archive,
      source?'-DBRISK_ANDROID_SDL2_SOURCE='+source:'-DBRISK_ANDROID_SDL2_LIBRARY='+library
    ].map(value=>JSON.stringify(value.replaceAll('\\','/'))).join(', ');
    const marker=/defaultConfig\s*\{/;
    if(!marker.test(gradle))throw new Error('Missing Android defaultConfig');
    gradle=gradle.replace(marker,value=>value+
      '\n        ndk { abiFilters "arm64-v8a" }'+
      '\n        externalNativeBuild { cmake { arguments '+args+' } }');
  }
}else if(source||library){
  throw new Error('Android SDL2 was configured without the native Brisk game archive');
}
await fs.writeFile(gradleFile,gradle);

const manifestFile=path.join(root,'android','app','src','main','AndroidManifest.xml');
let manifest=await fs.readFile(manifestFile,'utf8');
if(!manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES'))
  manifest=manifest.replace('<application',
    '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <application');
const xmlDir=path.join(root,'android','app','src','main','res','xml');
await fs.mkdir(xmlDir,{recursive:true});
await fs.writeFile(path.join(xmlDir,'brisk_update_paths.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n'+
  '<paths xmlns:android="http://schemas.android.com/apk/res/android">\n'+
  '  <files-path name="verified-brisk-apks" path="brisk-app-updates/" />\n'+
  '</paths>\n');
const provider=[
'        <provider',
'            android:name="androidx.core.content.FileProvider"',
'            android:authorities="com.briskemerald.briskdex.briskupdates"',
'            android:exported="false"',
'            android:grantUriPermissions="true">',
'            <meta-data android:name="android.support.FILE_PROVIDER_PATHS"',
'                android:resource="@xml/brisk_update_paths" />',
'        </provider>'
].join('\n');
if(!manifest.includes('com.briskemerald.briskdex.briskupdates')){
  if(!manifest.includes('</application>'))throw new Error('Missing Android application closing tag');
  manifest=manifest.replace('</application>',provider+'\n    </application>');
}
await fs.writeFile(manifestFile,manifest);
console.log(archive
  ?'Android JNI transport, update installer and full-game archive are configured.'
  :'Android JNI transport and update installer are configured; actual gameplay archive remains unavailable.');
