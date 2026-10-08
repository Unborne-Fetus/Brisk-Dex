$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Invoke-Step {
    param([string]$Name,[scriptblock]$Action)
    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

function Require-Command {
    param([string]$Name,[string]$Message)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw $Message }
}

function Quote-Bash {
    param([string]$Value)
    return "'" + ($Value -replace "'", "'\''") + "'"
}

try {
    Write-Host "Brisk Dex full local release build" -ForegroundColor Green
    Write-Host "Source branch: compat-branch"

    Require-Command 'git.exe' 'Git is required for Build All.'
    Require-Command 'wsl.exe' 'WSL is required to build the Linux packages locally.'
    Require-Command 'ssh.exe' 'Windows OpenSSH Client is required for macOS/iOS builds.'
    Require-Command 'scp.exe' 'Windows OpenSSH Client (scp) is required for macOS/iOS builds.'

    $branch = (& git.exe branch --show-current).Trim()
    if ($branch -ne 'compat-branch') { throw "Build All must be run from compat-branch. Current branch: $branch" }

    $dirty = & git.exe status --porcelain
    if ($dirty) { throw 'Build All requires a clean working tree so every platform is built from the exact same committed source.' }

    $commit = (& git.exe rev-parse HEAD).Trim()
    New-Item -ItemType Directory -Force -Path 'dist' | Out-Null

    Invoke-Step 'Build Windows installer and Android APK' {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tools\build_all.ps1'
    }

    Invoke-Step 'Check WSL Node.js' {
        & wsl.exe bash -lc 'command -v node >/dev/null && command -v npm >/dev/null'
    }

    $windowsPath = (Get-Location).Path
    $wslPath = (& wsl.exe wslpath -a ($windowsPath -replace '\','/')).Trim()
    if (-not $wslPath) { throw 'Could not convert the repository path for WSL.' }

    Invoke-Step 'Build Linux AppImage and DEB in WSL' {
        $cmd = "cd " + (Quote-Bash $wslPath) + " && npm ci && npm run release:test && npm run dist:linux"
        & wsl.exe bash -lc $cmd
    }

    $appImage = Get-ChildItem 'dist' -Filter '*.AppImage' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $deb = Get-ChildItem 'dist' -Filter '*.deb' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $appImage -or -not $deb) { throw 'Linux build did not produce both AppImage and DEB outputs.' }

    $macHost = $env:BRISK_MAC_HOST
    if (-not $macHost) {
        throw @'
Apple builds need access to a Mac because Xcode only runs on macOS.

Set BRISK_MAC_HOST to an SSH destination, for example:
  setx BRISK_MAC_HOST "username@192.168.1.50"

Then open a new terminal and run build-all.bat again.
The Mac only needs SSH enabled, Node.js 22+, npm, Xcode, and the Xcode command-line tools.
'@
    }

    $remoteBase = if ($env:BRISK_MAC_BUILD_DIR) { $env:BRISK_MAC_BUILD_DIR } else { '~/BriskDexBuild' }
    $archive = Join-Path $env:TEMP ("brisk-dex-" + $commit.Substring(0,12) + ".zip")
    if (Test-Path $archive) { Remove-Item $archive -Force }

    Invoke-Step 'Package exact committed source for Apple builds' {
        & git.exe archive --format=zip --output=$archive HEAD
    }
    if (-not (Test-Path $archive)) { throw 'Could not create the Apple build source archive.' }

    $remoteArchive = "/tmp/brisk-dex-$($commit.Substring(0,12)).zip"
    Invoke-Step 'Upload source to Mac' {
        & scp.exe $archive "$($macHost):$remoteArchive"
    }

    $remoteScript = @"
set -e
REMOTE_BASE=$remoteBase
ARCHIVE=$remoteArchive
WORK="\$REMOTE_BASE/$($commit.Substring(0,12))"
rm -rf "\$WORK"
mkdir -p "\$WORK"
unzip -q "\$ARCHIVE" -d "\$WORK"
cd "\$WORK"
command -v node >/dev/null
command -v npm >/dev/null
command -v xcodebuild >/dev/null
npm ci
npm run release:test
npm run dist:mac
npm run ios:prepare
npx cap add ios
npx cap sync ios
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
rm -rf Payload
mkdir -p Payload
cp -R build-ios/Build/Products/Release-iphoneos/App.app Payload/BriskDex.app
rm -f Brisk-Dex-iOS-Unsigned.ipa
zip -qry Brisk-Dex-iOS-Unsigned.ipa Payload
DMG=\$(find dist -maxdepth 1 -name '*.dmg' -type f | head -n 1)
test -n "\$DMG"
cp "\$DMG" Brisk-Dex-macOS.dmg
"@

    Invoke-Step 'Build macOS DMG and unsigned iOS IPA on Mac' {
        $remoteScript | & ssh.exe $macHost 'bash -s'
    }

    $remoteWork = "$remoteBase/$($commit.Substring(0,12))"
    Invoke-Step 'Download macOS DMG' {
        & scp.exe "$($macHost):$remoteWork/Brisk-Dex-macOS.dmg" 'dist\Brisk-Dex-macOS.dmg'
    }
    Invoke-Step 'Download unsigned iOS IPA' {
        & scp.exe "$($macHost):$remoteWork/Brisk-Dex-iOS-Unsigned.ipa" 'dist\Brisk-Dex-iOS-Unsigned.ipa'
    }

    Remove-Item $archive -Force -ErrorAction SilentlyContinue

    $exe = Get-ChildItem 'dist' -Filter '*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $apk = Get-Item 'dist\Brisk-Dex-Android.apk' -ErrorAction SilentlyContinue
    $dmg = Get-Item 'dist\Brisk-Dex-macOS.dmg' -ErrorAction SilentlyContinue
    $ipa = Get-Item 'dist\Brisk-Dex-iOS-Unsigned.ipa' -ErrorAction SilentlyContinue
    if (-not $exe -or -not $apk -or -not $appImage -or -not $deb -or -not $dmg -or -not $ipa) {
        throw 'Build All finished a build step but one or more release artifacts are missing.'
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "                 ALL BUILDS COMPLETE" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "Commit:  $commit"
    Write-Host "Windows: $($exe.FullName)"
    Write-Host "Android: $($apk.FullName)"
    Write-Host "Linux:   $($appImage.FullName)"
    Write-Host "Linux:   $($deb.FullName)"
    Write-Host "macOS:   $($dmg.FullName)"
    Write-Host "iOS:     $($ipa.FullName)"
    exit 0
}
catch {
    Write-Host ""
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
