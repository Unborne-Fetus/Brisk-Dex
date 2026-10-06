$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$repo = 'Unborne-Fetus/Brisk-Dex'
function Invoke-Gh {
    & $script:gh @args
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI failed (exit $LASTEXITCODE)." }
}
try {
    $command = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $command) {
        $installed = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
        if (Test-Path $installed) { $script:gh = $installed }
        else {
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
                throw 'Install GitHub CLI from https://cli.github.com and run build.bat again.'
            }
            & winget install --id GitHub.cli --exact --source winget --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path $installed)) {
                throw 'GitHub CLI installation failed. Install it from https://cli.github.com.'
            }
            $script:gh = $installed
        }
    } else { $script:gh = $command.Source }
    & $script:gh auth status --hostname github.com
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Sign in to GitHub to build your private repository.'
        Invoke-Gh auth login --hostname github.com --web --git-protocol https
    }
    $requestId = [Guid]::NewGuid().ToString()
    Write-Host 'Building the latest main branch on GitHub (local uncommitted edits are not included).'
    Invoke-Gh workflow run build-all.yml --repo $repo --ref main -f "request_id=$requestId"
    $run = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $runs = Invoke-Gh run list --repo $repo --workflow build-all.yml --event workflow_dispatch --limit 30 --json databaseId,displayTitle,url | ConvertFrom-Json
        $run = $runs | Where-Object { $_.displayTitle -eq "Build all - $requestId" } | Select-Object -First 1
        if ($run) { break }
        Start-Sleep -Seconds 5
    }
    if (-not $run) { throw 'Build was requested but could not be located. Check the GitHub Actions page.' }
    Write-Host $run.url
    & $script:gh run watch $run.databaseId --repo $repo --exit-status --interval 15
    $buildResult = $LASTEXITCODE
    # Keep successful platform outputs even if another platform fails.
    $outputDir = Join-Path (Get-Location) ("dist\build-" + $run.databaseId)
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    & $script:gh run download $run.databaseId --repo $repo --dir $outputDir
    if ($LASTEXITCODE -ne 0) { throw "Could not download build outputs. See $($run.url)" }
    Get-ChildItem $outputDir -Recurse -File | Where-Object { $_.Extension -in '.exe','.apk','.ipa' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path (Get-Location) 'dist') -Force
    }
    Write-Host "Downloaded files to $outputDir and copied installers into dist."
    Write-Host 'The iOS IPA is unsigned; sign it before installing on an iPhone.'
    if ($buildResult -ne 0) { throw "One or more platforms failed. Successful outputs were downloaded. See $($run.url)" }
    foreach ($extension in '.exe','.apk','.ipa') {
        if (-not (Get-ChildItem $outputDir -Recurse -File | Where-Object { $_.Extension -eq $extension })) {
            throw "Build did not produce $extension. See $($run.url)"
        }
    }
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
