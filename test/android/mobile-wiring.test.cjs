'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Android mobile entrypoint installs native game and signed APK updater',()=>{
  const bridge=read('android-bridge-src.js');
  assert.match(bridge,/installAndroidNativeGame\(\{Capacitor,registerPlugin\}\)/);
  assert.match(bridge,/installAndroidAppUpdates\(\{Capacitor,registerPlugin\}\)/);
  assert.match(read('android-native/src/mobile-native-game.js'),/getNativeGameProfiles/);
  assert.match(read('android-native/src/mobile-app-updates.js'),/async checkForUpdates\(/);
  assert.match(read('tools/patch_android.mjs'),/install_android_native\.mjs/);
});

test('Generated APK safely registers native plugins and a distinct installer provider',t=>{
  const base='android/app/src/main/';
  const activity=path.join(root,base,'java/com/briskemerald/briskdex/MainActivity.java');
  if(!fs.existsSync(activity)){t.skip('Android project has not been generated');return;}
  const java=fs.readFileSync(activity,'utf8');
  for(const plugin of ['SaveFilePickerPlugin','BriskNativeGamePlugin','BriskAppUpdaterPlugin'])
    assert.match(java,new RegExp('registerPlugin\\('+plugin+'\\.class\\)'));
  const manifest=read(base+'AndroidManifest.xml');
  assert.match(manifest,/REQUEST_INSTALL_PACKAGES/);
  assert.equal((manifest.match(/com\.briskemerald\.briskdex\.briskupdates/g)||[]).length,1);
  assert.match(manifest,/brisk_update_paths/);
  const gradle=read('android/app/build.gradle');
  assert.match(gradle,/android-native\/CMakeLists\.txt/);
  const provider=read('android-native/java/BriskAppUpdaterPlugin.java');
  assert.match(provider,/getPackageName\(\)\+"\.briskupdates"/);
});
