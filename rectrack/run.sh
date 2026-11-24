#!/usr/bin/env bash
# Start the Rectification Tracker (macOS / Linux)
set -e
cd "$(dirname "$0")"

if ! python3 -c "import openpyxl" 2>/dev/null; then
  echo "Installing dependency (openpyxl)..."
  python3 -m pip install --quiet -r requirements.txt
fi

PORT="${1:-8010}"
python3 server.py --port "$PORT"
