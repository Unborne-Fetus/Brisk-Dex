@echo off
setlocal
cd /d "%~dp0"
echo Building one Windows Brisk Dex installer with integrated native expansion...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build_integrated_windows.ps1"
set "status=%ERRORLEVEL%"
if not "%status%"=="0" echo Integrated Brisk Dex build failed. Review the console output.
pause
exit /b %status%
