@echo off
cd /d "%~dp0"
echo ============================================================
echo                 Brisk Dex - Build All
echo ============================================================
echo.
echo Builds every Brisk Dex release target:
echo   - Windows installer (.exe)
echo   - Android (.apk)
echo   - Linux (.AppImage and .deb)
echo   - macOS (.dmg)
echo   - iOS unsigned (.ipa)
echo.
echo Windows and Android are built on this PC.
echo Linux is built through WSL.
echo macOS and iOS are built on a Mac over SSH.
echo.
if not exist "%~dp0tools\build_everything.ps1" (
    echo Missing tools\build_everything.ps1. Pull the complete compat-branch.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build_everything.ps1"
set "build_result=%errorlevel%"
echo.
if "%build_result%"=="0" (
    echo All Brisk Dex builds completed successfully.
) else (
    echo Build All failed. See the error above.
)
pause
exit /b %build_result%
