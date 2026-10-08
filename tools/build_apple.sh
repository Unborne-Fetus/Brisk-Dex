#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Brisk Dex Apple build =="
command -v node >/dev/null 2>&1 || { echo "Node.js is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required."; exit 1; }
command -v xcodebuild >/dev/null 2>&1 || { echo "Xcode command line tools are required."; exit 1; }

mkdir -p dist
npm ci
npm run battle:coverage
npm run battle:smoke

echo "== Build macOS DMG =="
npm run dist:mac
DMG="$(find dist -maxdepth 1 -type f -name '*.dmg' -print -quit)"
if [ -z "$DMG" ]; then
  echo "macOS build completed but no DMG was found."
  exit 1
fi
cp "$DMG" dist/Brisk-Dex-macOS.dmg

echo "== Prepare iOS project =="
npm run ios:prepare
if [ ! -d ios ]; then
  npx cap add ios
fi
npx cap sync ios

echo "== Build unsigned iOS app =="
rm -rf build-ios Payload
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath build-ios \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

APP="build-ios/Build/Products/Release-iphoneos/App.app"
if [ ! -d "$APP" ]; then
  echo "iOS build completed but App.app was not found."
  exit 1
fi

mkdir -p Payload
cp -R "$APP" Payload/BriskDex.app
rm -f dist/Brisk-Dex-iOS-Unsigned.ipa
zip -qry dist/Brisk-Dex-iOS-Unsigned.ipa Payload

echo "Apple builds complete:"
echo "  dist/Brisk-Dex-macOS.dmg"
echo "  dist/Brisk-Dex-iOS-Unsigned.ipa"
