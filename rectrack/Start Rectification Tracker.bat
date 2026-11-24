@echo off
setlocal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul || set "PY=py"

%PY% --version >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Python was not found.
  echo   Please install Python 3.9+ from https://www.python.org/downloads/
  echo   and tick "Add Python to PATH" during installation.
  echo.
  pause
  exit /b 1
)

%PY% -c "import openpyxl" 2>NUL
if errorlevel 1 (
  echo Installing required component ^(openpyxl^), one moment...
  %PY% -m pip install --quiet -r requirements.txt
)

%PY% launcher.py

echo.
echo The tracker has stopped. You can close this window.
pause
