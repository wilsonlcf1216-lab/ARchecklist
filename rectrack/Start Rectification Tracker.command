#!/bin/bash
# Double-click this file in Finder to start the Rectification Tracker.
cd "$(dirname "$0")" || exit 1

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python

if ! "$PY" --version >/dev/null 2>&1; then
  echo "Python 3 was not found. Please install it from https://www.python.org/downloads/"
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

"$PY" -c "import openpyxl" 2>/dev/null || {
  echo "Installing required component (openpyxl), one moment..."
  "$PY" -m pip install --quiet -r requirements.txt
}

"$PY" launcher.py
echo
read -n 1 -s -r -p "The tracker has stopped. Press any key to close..."
