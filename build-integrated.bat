@echo off
setlocal
cd /d "%~dp0"
echo Building one Windows Brisk Dex installer with integrated native Brisk Emerald...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Transcript -LiteralPath 'build-integrated.log' -Force; try { & '.\tools\build_integrated_windows.ps1'; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } catch { Write-Host $_ -ForegroundColor Red; exit 1 } finally { Stop-Transcript }"
set "status=%ERRORLEVEL%"
if not "%status%"=="0" echo Integrated Brisk Dex build failed. See build-integrated.log in this folder.
pause
exit /b %status%
