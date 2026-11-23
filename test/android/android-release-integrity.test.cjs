'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('TLS certificate chain errors have an actionable secure fallback, not a trust bypass',()=>{
  const java=read('android-native/java/BriskAppUpdaterPlugin.java');
  assert.match(java,/SSLHandshakeException/);
  assert.match(java,/CertPathValidatorException/);
  assert.match(java,/hasChainValidationFailure\(error\)/);
  assert.match(java,/Open the official GitHub releases page in your browser/);
  assert.match(java,/void openDownloadPage\(PluginCall call\)/);
  assert.match(java,/https:\/\/github\.com\/Unborne-Fetus\/Brisk-Dex\/releases/);
  assert.match(java,/sameSignature\(old,target\)/);
  assert.match(java,/hex\(digestFile\(file\)\)\.equals\(hash\)/);
  assert.doesNotMatch(java,/(?:ALLOW_ALL_HOSTNAME_VERIFIER|setDefaultHostnameVerifier|setDefaultSSLSocketFactory|TrustAllCertificates)/);
  assert.match(read('.github/workflows/build-android.yml'),/android-channel-cert\.sha256/);
  assert.match(read('.github/workflows/build-android.yml'),/Signing key differs from existing android-updates installation/);
  assert.match(read('tools/android-channel-cert.sha256').trim(),/^[0-9a-f]{64}$/);
  assert.match(java,/fetchManifest\(\)/);
  assert.match(java,/raw\.githubusercontent\.com\/Unborne-Fetus\/Brisk-Dex\/main\/docs\/android-update\.json/);
  const mirror=JSON.parse(read('docs/android-update.json'));
  assert.equal(mirror.packageName,'com.briskemerald.briskdex');
  assert.match(mirror.sha256,/^[0-9a-f]{64}$/);
  assert.ok(mirror.versionCode>0&&mirror.bytes>10000);
  assert.match(read('.github/workflows/build-android.yml'),/contents\/docs\/android-update\.json/);
  const api=read('android-native/src/mobile-app-updates.js');
  assert.match(api,/openAndroidDownloads\(\)/);
  assert.match(api,/updater\.openDownloadPage\(\)/);
  assert.match(read('native-settings-ui.js'),/native-update-download/);
  assert.match(read('index.html'),/id="native-update-download"/);
});

test('Android full game build never substitutes JNI transport for real game binaries',()=>{
  const build=read('tools/build_android_game_archive.sh');
  assert.match(build,/prepare_android_native_source\.sh/);
  assert.match(build,/android-game-archive/);
  assert.match(build,/brisk_android_game_main/);
  assert.match(build,/AgbMain/);
  assert.match(read('tools/package_android_full_game.sh'),/--require-game/);
  const cmake=read('android-native/CMakeLists.txt');
  assert.match(cmake,/if\(BRISK_NATIVE_ANDROID_ARCHIVE\)/);
  assert.match(cmake,/add_library\(briskgame SHARED/);
  assert.match(cmake,/--no-undefined/);
  const workflow=read('.github/workflows/android-native-engine.yml');
  assert.match(workflow,/bash tools\/build_android_game_archive\.sh/);
  assert.match(workflow,/bash tools\/package_android_full_game\.sh/);
});

test('In-app Android updates do not mislabel newer preview builds as fully current',()=>{
  const java=read('android-native/java/BriskAppUpdaterPlugin.java');
  assert.match(java,/if\(nextCode<installedCode\)/);
  assert.match(java,/if\(nextCode==installedCode\)/);
  assert.match(java,/channelBehind/);
  assert.match(java,/No newer compatible signed game update is published/);
  assert.match(java,/Preview APKs can be missing libbriskgame\.so/);
  assert.doesNotMatch(java,/You already have the latest published Android APK/);
  assert.match(java,/ASSET_PREFIX\+"android-update\.json"/);
  assert.doesNotMatch(java,/android-update\.json\?t=/);
  assert.match(java,/Cache-Control/);
});

test('NDK Android platform entry point is not silently remapped to SDL_main',()=>{
  const compiler=read('tools/android_compile_source.py');
  assert.match(compiler,/SDL_MAIN_HANDLED=1/);
  assert.match(compiler,/main=brisk_android_game_main/);
  const archive=read('tools/build_android_game_archive.sh');
  assert.match(archive,/Actual ARM64 entry-point symbols/);
  assert.match(archive,/native-symbols\.txt/);
});
