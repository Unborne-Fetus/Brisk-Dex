$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Require-Command([string]$Name,[string]$Instruction) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw $Instruction }
}
Require-Command 'wsl.exe' 'WSL Ubuntu is required to compile the internal native engine; follow the upstream compiler instructions.'
Require-Command 'node.exe' 'Node.js 22 or newer is required to build Brisk Dex.'
Require-Command 'npm.cmd' 'npm was not found. Install Node.js.'

$repo=(Get-Location).Path
$wslRepo=(& wsl.exe wslpath -a -u $repo).Trim()
if ($LASTEXITCODE -ne 0 -or -not $wslRepo) { throw 'Could not resolve the Brisk Dex folder inside WSL.' }

# Shell-quote paths so C:\ROM Hacks\Brisk-Dex and other paths with spaces work.
$quoted="'"+($wslRepo -replace "'", "'\''")+"'"
Write-Host 'Building the expansion engine into the Brisk Dex internal resource folder...' -ForegroundColor Cyan
& wsl.exe bash -lc ("cd "+$quoted+" && bash tools/build-native-expansion.sh windows")
if ($LASTEXITCODE -ne 0) { throw 'Native expansion build failed; no incomplete game installer will be created.' }
$nativeExe=Join-Path $repo 'native-game\win32\pokeemerald-native.exe'
$nativeDll=Join-Path $repo 'native-game\win32\SDL2.dll'
if (-not (Test-Path $nativeExe) -or -not (Test-Path $nativeDll)) {
    throw 'Integrated native engine is missing from the staging directory.'
}
Write-Host 'Building a single Brisk Dex Windows installer...' -ForegroundColor Cyan
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
& npm.cmd run desktop:test
if ($LASTEXITCODE -ne 0) { throw 'Desktop tests failed.' }
& npm.cmd run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
Write-Host 'Brisk Dex installer with staged internal expansion engine built into dist/.' -ForegroundColor Green
Write-Host 'Do not publicly distribute compiled game assets without the required rights.'
