@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer first.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8790/game/index.html"
node tools\serve_native_game.mjs
pause
