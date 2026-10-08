@echo off
setlocal
cd /d "%~dp0"
set "GAME_DIR=%~1"
if "%GAME_DIR%"=="" (
  if exist "..\Pokemon Brisk Emerald\src\data\wild_encounters.json" set "GAME_DIR=..\Pokemon Brisk Emerald"
)
if "%GAME_DIR%"=="" (
  echo Brisk Emerald source not found.
  echo Usage: refresh-game-data.bat "C:\ROM Hacks\Pokemon Brisk Emerald"
  exit /b 1
)
if not exist "%GAME_DIR%\src\data\wild_encounters.json" (
  echo Invalid Brisk Emerald directory: %GAME_DIR%
  exit /b 1
)
where py >nul 2>&1
if not errorlevel 1 (
  py -3 tools\extract_data.py "%GAME_DIR%"
) else (
  python tools\extract_data.py "%GAME_DIR%"
)
if errorlevel 1 exit /b 1
echo.
echo Updated Brisk Dex data and graphics from "%GAME_DIR%".
echo Review and commit the generated files, then use build.bat or build-all.bat.
endlocal
