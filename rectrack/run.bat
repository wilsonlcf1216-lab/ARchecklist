@echo off
REM Start the Rectification Tracker (Windows)
cd /d "%~dp0"
python -c "import openpyxl" 2>NUL
if errorlevel 1 (
  echo Installing dependency ^(openpyxl^)...
  python -m pip install --quiet -r requirements.txt
)
python server.py --port 8010
pause
