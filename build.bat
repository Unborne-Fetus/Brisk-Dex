@echo off
cd /d "%~dp0"
echo Brisk Dex - Windows, Android and iOS
echo Builds on GitHub and downloads EXE, APK and unsigned IPA into dist.
if not exist "%~dp0tools\build_all.ps1" (
    echo Missing tools\build_all.ps1. Download or pull the complete repository.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build_all.ps1"
set "build_result=%errorlevel%"
pause
exit /b %build_result%
