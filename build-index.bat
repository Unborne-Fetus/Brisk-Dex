@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to GENERATE the standalone file, but not to use it.
  echo Install Node.js, then run build-index.bat again.
  pause
  exit /b 1
)
node tools\build_standalone.mjs
if errorlevel 1 (
  echo Standalone index build failed.
  pause
  exit /b 1
)
echo.
echo Finished: standalone\index.html
echo Share that ONE file. It works by double-clicking without a launcher.
pause
