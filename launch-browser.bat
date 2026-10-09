@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to launch the browser version.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)
node tools\serve_browser.mjs
if errorlevel 1 pause
