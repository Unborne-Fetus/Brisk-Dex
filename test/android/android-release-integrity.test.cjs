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
  assert.match(read('.github/workflows/build-android.yml'),/android-channel-cert\\.sha256/);
  assert.match(read('.github/workflows/build-android.yml'),/Signing key differs from existing android-updates installation/);
  assert.match(read('tools/android-channel-cert.sha256').trim(),/^[0-9a-f]{64}$/);
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
