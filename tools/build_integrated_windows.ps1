$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Require-Command([string]$Name,[string]$Instruction) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw $Instruction }
}
Require-Command 'wsl.exe' 'WSL Ubuntu is required to compile the internal native engine; follow the upstream compiler instructions.'
Require-Command 'node.exe' 'Node.js 22 or newer is required to build Brisk Dex.'
Require-Command 'npm.cmd' 'npm was not found. Install Node.js.'

& node.exe -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or newer is required. Update Node.js and rerun this build.' }
$repo=(Get-Location).Path
# --exec bypasses the WSL distro's login shell. A systemd-user-session warning
# may still appear on some installations, but only a nonzero exit code is fatal.
$wslRepoOutput = & wsl.exe --exec wslpath -a -u $repo
$wslPathExit = $LASTEXITCODE
$wslRepo = ($wslRepoOutput | Select-Object -Last 1)
if ($wslPathExit -ne 0 -or [string]::IsNullOrWhiteSpace($wslRepo)) {
    throw 'Could not resolve the Brisk Dex folder inside WSL. Run wsl --status to check the distro.'
}

# Quote paths such as C:\ROM Hacks\Brisk-Dex, including unusual apostrophes.
$quoted = "'" + ($wslRepo.Trim() -replace "'", "'\''") + "'"

# A Windows checkout may already contain CRLF even after .gitattributes is
# added. Normalize only the Bash script's input stream, without modifying the
# working tree or requiring users to install dos2unix.
$normalizeScript = 'sed ''s/\r$//'' tools/build-native-expansion.sh'
# Passing the root explicitly preserves Bash filename-relative paths when streamed.
$wslCommand = "set -o pipefail; cd $quoted && $normalizeScript | BRISK_NATIVE_ROOT=$quoted BRISK_NATIVE_PROFILE=brisk bash -s -- windows --install"

Write-Host 'Building Brisk Emerald into the Brisk Dex internal resource folder...' -ForegroundColor Cyan
& wsl.exe --exec bash --noprofile --norc -c $wslCommand
if ($LASTEXITCODE -ne 0) {
    throw 'Native Brisk Emerald build failed. See the dependency installation or native compiler error above.'
}
$nativeExe=Join-Path $repo 'native-game\win32\pokeemerald-native.exe'
$nativeDll=Join-Path $repo 'native-game\win32\SDL2.dll'
if (-not (Test-Path $nativeExe) -or -not (Test-Path $nativeDll)) {
    throw 'Integrated native engine is missing from the staging directory.'
}
$buildInfoPath=Join-Path $repo 'native-game\win32\build-info.json'
if (-not (Test-Path $buildInfoPath)) { throw 'Native Brisk build identity is missing.' }
$buildInfo=Get-Content -Raw $buildInfoPath | ConvertFrom-Json
$sourcePin=Get-Content -Raw (Join-Path $PSScriptRoot 'brisk-native-source.json') | ConvertFrom-Json
if ($buildInfo.profile -ne 'brisk' -or $buildInfo.brisk_commit -ne $sourcePin.brisk_commit) {
    throw 'The staged engine does not match the required Brisk Emerald source. Installer creation stopped.'
}
Write-Host 'Building a single Brisk Dex Windows installer...' -ForegroundColor Cyan
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
& npm.cmd run desktop:test
if ($LASTEXITCODE -ne 0) { throw 'Desktop tests failed.' }
& npm.cmd run dist:win -- --x64
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
Write-Host 'Brisk Dex installer with staged internal Brisk Emerald engine built into dist/.' -ForegroundColor Green
Write-Host 'Do not publicly distribute compiled game assets without the required rights.'
