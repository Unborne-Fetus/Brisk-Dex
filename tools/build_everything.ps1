$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host ''
    Write-Host "== $Name ==" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

function Require-Command {
    param([string]$Name, [string]$Message)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw $Message }
}

try {
    New-Item -ItemType Directory -Force -Path 'dist' | Out-Null
    Write-Host 'Brisk Dex full local release build' -ForegroundColor Green
    Write-Host 'Windows + Android: this PC'
    Write-Host 'Linux: WSL'
    Write-Host 'macOS + iOS: configured Mac over SSH'

    Invoke-Step 'Build Windows installer and Android APK' {
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\build_all.ps1"
    }

    Require-Command 'wsl.exe' 'WSL is required for the Linux build. Install WSL, then run build-all.bat again.'
    $windowsRoot = (Get-Location).Path
    $wslRoot = (& wsl.exe wslpath -a "$windowsRoot").Trim()
    if (-not $wslRoot) { throw 'Could not translate the repository path for WSL.' }

    Invoke-Step 'Build Linux AppImage and DEB through WSL' {
        & wsl.exe bash -lc "set -e; cd \"$wslRoot\"; command -v node >/dev/null; command -v npm >/dev/null; npm ci; npm run battle:coverage; npm run battle:smoke; npm run dist:linux"
    }

    if (-not (Get-ChildItem 'dist' -Filter '*.AppImage' -File)) { throw 'Linux AppImage was not found in dist.' }
    if (-not (Get-ChildItem 'dist' -Filter '*.deb' -File)) { throw 'Linux DEB was not found in dist.' }

    Invoke-Step 'Restore Windows Node dependencies after WSL build' {
        & npm.cmd ci
    }

    $macHost = $env:BRISK_MAC_HOST
    if (-not $macHost) {
        Write-Host ''
        Write-Host 'Apple builds require access to a Mac with SSH enabled.' -ForegroundColor Yellow
        $macHost = Read-Host 'Mac SSH target (example: username@192.168.1.50)'
        if (-not $macHost) { throw 'No Mac SSH target was provided, so macOS/iOS cannot be built.' }
    }
    Require-Command 'ssh.exe' 'OpenSSH Client is required for the Mac build.'
    Require-Command 'scp.exe' 'OpenSSH Client scp is required for the Mac build.'
    Require-Command 'tar.exe' 'Windows tar is required for packaging the source sent to the Mac.'

    $macPath = $env:BRISK_MAC_PATH
    if (-not $macPath) { $macPath = '~/Brisk-Dex-build' }
    $archive = Join-Path $env:TEMP 'brisk-dex-build-all.tar.gz'
    if (Test-Path $archive) { Remove-Item $archive -Force }

    Invoke-Step 'Package source for Mac' {
        & tar.exe --exclude=.git --exclude=node_modules --exclude=dist --exclude=android --exclude=ios --exclude=www -czf $archive .
    }
    Invoke-Step 'Prepare Mac build directory' {
        & ssh.exe $macHost "rm -rf $macPath && mkdir -p $macPath"
    }
    Invoke-Step 'Upload source to Mac' {
        & scp.exe $archive "${macHost}:$macPath/brisk-dex-source.tar.gz"
    }
    Invoke-Step 'Build macOS DMG and unsigned iOS IPA on Mac' {
        & ssh.exe $macHost "set -e; cd $macPath; tar -xzf brisk-dex-source.tar.gz; chmod +x tools/build_apple.sh; ./tools/build_apple.sh"
    }
    Invoke-Step 'Download Apple artifacts' {
        & scp.exe "${macHost}:$macPath/dist/Brisk-Dex-macOS.dmg" 'dist\Brisk-Dex-macOS.dmg'
        if ($LASTEXITCODE -ne 0) { throw 'Could not download the macOS DMG.' }
        & scp.exe "${macHost}:$macPath/dist/Brisk-Dex-iOS-Unsigned.ipa" 'dist\Brisk-Dex-iOS-Unsigned.ipa'
    }

    if (Test-Path $archive) { Remove-Item $archive -Force }
    if (-not (Get-ChildItem 'dist' -Filter '*.exe' -File)) { throw 'Windows installer is missing from dist.' }
    if (-not (Test-Path 'dist\Brisk-Dex-Android.apk')) { throw 'Android APK is missing from dist.' }
    if (-not (Test-Path 'dist\Brisk-Dex-macOS.dmg')) { throw 'macOS DMG is missing from dist.' }
    if (-not (Test-Path 'dist\Brisk-Dex-iOS-Unsigned.ipa')) { throw 'iOS IPA is missing from dist.' }

    Write-Host ''
    Write-Host 'All Brisk Dex release builds completed.' -ForegroundColor Green
    Write-Host "Artifacts: $((Resolve-Path 'dist').Path)"
    Get-ChildItem 'dist' -File | Where-Object { $_.Extension -in '.exe','.apk','.AppImage','.deb','.dmg','.ipa' } | ForEach-Object { Write-Host ('  ' + $_.Name) }
    exit 0
}
catch {
    Write-Host ''
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
