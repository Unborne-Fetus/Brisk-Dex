# Android updates and full-game compatibility

## “Chain validation failed” while checking for updates

This is a certificate/trust failure during an HTTPS connection, not a request
to disable HTTPS security. Check Android's automatic date/time, try another
trusted Wi-Fi or mobile-data connection, and inspect whether a VPN, proxy,
Private DNS or network filter intercepts HTTPS certificates.

The Android updater now names this failure and offers an **Official APK
releases** button, which opens the real GitHub release page in the device's
browser. The browser route still requires valid HTTPS and Android's installer
still validates the APK signature.

## “App not installed”, signing/certificate mismatch

Android cannot install an APK over an existing app unless their package IDs,
version codes and signing certificates are compatible. Do not work around
Android's signature check. **Do not uninstall while the only copy of a game
save exists inside the app.** Export and verify game-save backups first.

The established `android-updates` channel was signed by a certificate with
the public SHA-256 fingerprint recorded in
[`tools/android-channel-cert.sha256`](../tools/android-channel-cert.sha256).
This is *not* a secret. CI now checks both the supplied signing key and the
built APK against this exact certificate before allowing it to represent
the established update channel.

An app installed from a preview that used a different, temporary debug
certificate cannot be upgraded in place with the established channel key.
That Android platform restriction remains even when both APKs come from the
same GitHub repository. The safe route requires exporting data, confirming the
backup is readable, and then restoring it after a compatible fresh install.

To enable compatible signed CI builds, the repository maintainer must
configure these **encrypted GitHub Actions secrets**, using the existing
original signing key (never committing or sharing the key itself):

- `BRISK_ANDROID_KEYSTORE_BASE64` — base64 of the complete keystore file
- `BRISK_ANDROID_STORE_PASSWORD` — keystore password
- `BRISK_ANDROID_KEY_PASSWORD` — key-entry password
- `BRISK_ANDROID_KEY_ALIAS` — key-entry alias

Only configure the actual key used by the established `android-updates`
APK; a newly generated key will fail the fingerprint gate. Avoid printing
secret values in commands, workflow logs or issue reports. The release job
also checks the old and new APK certificates and verifies the APK SHA-256
manifest before promoting a build to the in-app update channel.

## “libbriskgame.so not packaged”

`libbriskandroid.so` is the JNI communication transport; it is not the game.
The actual pinned Brisk C engine must compile as a complete ARM64 static
archive and link into `lib/arm64-v8a/libbriskgame.so`. The bridge validates
the engine API and exact source revision at runtime.

Build the real archive from the pinned source using
`tools/build_android_game_archive.sh` on Linux, with Android SDK/NDK
27.2.12479018, GNU AArch64 assembler and SDL2 2.30.12 sources. Then
`tools/package_android_full_game.sh` can link it into the APK.
`tools/inspect_android_apk.py --require-game` fails if the game library is
missing. The `Compile genuine Brisk Android game engine` workflow exercises
that path without distributing unverified game binaries.

Even a successfully linked library must still pass native startup, frame
rendering, audio, battle, save/reload and hardware-device testing. Do not
describe transport-only previews or merely successful JNI compilation as
playable integrated Android games.
