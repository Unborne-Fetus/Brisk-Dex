@echo off
cd /d "%~dp0"
echo ============================================================
echo                 Brisk Dex - Build ALL
echo ============================================================
echo.
echo Produces Windows, Android, Linux, macOS, and iOS release files.
echo Windows + Android build locally, Linux through WSL, Apple on a Mac over SSH.
echo.
if not exist "%~dp0tools\build_everything.ps1" (
    echo Missing tools\build_everything.ps1. Download or pull the complete repository.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build_everything.ps1"
set "build_result=%errorlevel%"
echo.
if "%build_result%"=="0" (
    echo All Brisk Dex release builds completed successfully.
) else (
    echo Build All stopped with an error. See the message above.
)
pause
exit /b %build_result%
