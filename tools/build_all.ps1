$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}


function Invoke-NpmDependencies {
    $attempts = 3
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        Write-Host "npm dependency install attempt $attempt of $attempts..."
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -eq 0) { return }

        $ciExit = $LASTEXITCODE
        Write-Host "npm ci failed with exit code $ciExit." -ForegroundColor Yellow

        if ($attempt -lt $attempts) {
            Write-Host "Retrying after a short delay (Windows can temporarily lock files in node_modules)..." -ForegroundColor Yellow
            Start-Sleep -Seconds (2 * $attempt)
        }
    }

    Write-Host "npm ci is still blocked. Falling back to a non-destructive npm install so an existing node_modules folder does not have to be deleted." -ForegroundColor Yellow
    & npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "Install dependencies failed with exit code $LASTEXITCODE. Windows is still blocking npm from accessing a file. Close any running Brisk Dex/Electron/Node process and rerun build.bat."
    }
}

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js is required. Install Node.js 22 or newer and run build.bat again.'
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'npm was not found. Reinstall Node.js and run build.bat again.'
    }
    if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
        throw 'Java 21 is required for the Android build. Install JDK 21 and run build.bat again.'
    }

    $sdkRoot = $env:ANDROID_SDK_ROOT
    if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_HOME }
    if (-not $sdkRoot) {
        $defaultSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
        if (Test-Path $defaultSdk) {
            $sdkRoot = $defaultSdk
            $env:ANDROID_SDK_ROOT = $sdkRoot
            $env:ANDROID_HOME = $sdkRoot
        }
    }
    if (-not $sdkRoot -or -not (Test-Path $sdkRoot)) {
        throw 'Android SDK was not found. Install Android Studio / Android SDK, then run build.bat again.'
    }

    New-Item -ItemType Directory -Force -Path 'dist' | Out-Null

    Invoke-Step 'Install dependencies' {
        Invoke-NpmDependencies
    }

    Invoke-Step 'Verify battle effect coverage' {
        & npm.cmd run battle:coverage
    }

    Invoke-Step 'Smoke test online battle relay' {
        & npm.cmd run battle:smoke
    }

    Invoke-Step 'Build Windows installer' {
        & npm.cmd run dist:win
    }

    Invoke-Step 'Prepare Android web bundle' {
        & npm.cmd run android:prepare
    }

    if (-not (Test-Path 'android')) {
        Invoke-Step 'Create Android project' {
            & npx.cmd cap add android
        }
    }

    Invoke-Step 'Sync Android project' {
        & npx.cmd cap sync android
    }

    Invoke-Step 'Patch Android native integration' {
        & node tools/patch_android.mjs
    }

    Invoke-Step 'Build Android APK' {
        Push-Location android
        try {
            & .\gradlew.bat assembleDebug
        } finally {
            Pop-Location
        }
    }

    $apk = 'android\app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path $apk)) {
        throw "Android build completed but APK was not found at $apk."
    }

    Copy-Item -LiteralPath $apk -Destination 'dist\Brisk-Dex-Android.apk' -Force

    $exe = Get-ChildItem 'dist' -Filter '*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $exe) {
        throw 'Windows build completed but no .exe installer was found in dist.'
    }

    Write-Host ""
    Write-Host 'Build complete.' -ForegroundColor Green
    Write-Host "Windows: $($exe.FullName)"
    Write-Host "Android: $((Resolve-Path 'dist\Brisk-Dex-Android.apk').Path)"
    exit 0
}
catch {
    Write-Host ""
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
