@echo off
setlocal EnableExtensions
set "ROM_FILE=%~1"
set "SOURCE_DIR=%~2"
if not defined ROM_FILE set /p "ROM_FILE=Path to compiled Emerald-based .gba ROM: "
if not defined SOURCE_DIR set /p "SOURCE_DIR=Path to the matching game source checkout: "
if not exist "%ROM_FILE%" (
  echo ERROR: ROM not found: %ROM_FILE%
  exit /b 1
)
if not exist "%SOURCE_DIR%\include\constants\species.h" (
  echo ERROR: Expected an Emerald-family source folder with include\constants\species.h.
  exit /b 1
)
for %%A in ("%ROM_FILE%") do set "ROM_ABS=%%~fA" & set "OUTPUT_ROM=%%~dpnA-indexed.gba"
for %%A in ("%SOURCE_DIR%") do set "SOURCE_ABS=%%~fA"
pushd "%~dp0"
echo.
echo Extracting ROM-specific Pokemon, trainers, maps, items, routes, icons, battle sprites and cries...
python tools\build_compat_rom.py --rom "%ROM_ABS%" --source "%SOURCE_ABS%" --output "%OUTPUT_ROM%"
if errorlevel 1 (
  echo.
  echo Indexing failed, potentially because the full art collection exceeds GBA ROM capacity.
  echo To create a smaller index, retry with:
  echo python tools\build_compat_rom.py --rom "%ROM_ABS%" --source "%SOURCE_ABS%" --output "%OUTPUT_ROM%" --no-art
  echo The original ROM and source code are unchanged.
  popd
  exit /b 1
)
popd
echo.
echo Indexed ROM ready: %OUTPUT_ROM%
echo Open this .gba in Brisk Dex. A save is optional.
exit /b 0
