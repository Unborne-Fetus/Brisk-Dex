@echo off
setlocal EnableExtensions
set "ROM_FILE=%~1"
set "SOURCE_DIR=%~2"
if not defined ROM_FILE set /p "ROM_FILE=Path to the compiled Brisk Emerald .gba: "
if not defined SOURCE_DIR set /p "SOURCE_DIR=Path to matching Pokemon Brisk Emerald source folder: "
if not exist "%ROM_FILE%" (
  echo ERROR: ROM file does not exist: %ROM_FILE%
  exit /b 1
)
if not exist "%SOURCE_DIR%\src\data\wild_encounters.json" (
  echo ERROR: This is not a Brisk Emerald source folder: %SOURCE_DIR%
  exit /b 1
)
for %%A in ("%ROM_FILE%") do set "ROM_ABS=%%~fA" & set "OUTPUT_ROM=%%~dpnA-indexed.gba"
for %%A in ("%SOURCE_DIR%") do set "SOURCE_ABS=%%~fA"
pushd "%~dp0"
echo.
echo 1/2 Extracting exact game source data, trainers, maps and graphics...
python tools\extract_data.py "%SOURCE_ABS%"
if errorlevel 1 (
  echo ERROR: Source extraction failed. Check Python and Pillow installation.
  popd
  exit /b 1
)
echo.
echo 2/2 Embedding all available data into the GBA file...
python tools\embed_rom_index.py "%ROM_ABS%" --output "%OUTPUT_ROM%"
if errorlevel 1 (
  echo ERROR: Indexed ROM creation failed. The original ROM was not changed.
  popd
  exit /b 1
)
popd
echo.
echo Indexed ROM ready: %OUTPUT_ROM%
echo Import this single .gba in Brisk Dex Settings.
exit /b 0
