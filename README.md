# ARchecklist — Hospital Building Rectification Tracker

A local web app to consolidate handover inspection Excels, track rectification
progress (expected completion date + status) for a multi-month project, and
sort/filter the data by a single heading or any combination of headings.

## What it does

- **Import** the standard handover inspection template (`Slag List` sheet).
  Blank template rows are ignored; header metadata (Project, Prepared by, Date,
  Floor, Ward/Unit) is captured per file. Import as many files as you like — items are added, never overwritten.
- **Classify** each defect item by Priority Level (1–4), Type of Issue,
  General Category, SoA (area type) and Room, with a free-text Details Description.
- **Photos**: at least two per item (overview + close-up). Either upload them in
  the app, or point the app at a photos folder — images whose file name contains
  the item's Photo Reference Number are matched automatically.
- **Track progress**: Expected Completion Date and Rectification Status
  (Not started / In progress / Completed / Verified). Completed/Verified dates are
  stamped automatically; overdue items are highlighted.
- **Sort & filter**: click a column header to sort; Shift+click to add a secondary
  sort (e.g. Type of Issue + Priority). Combine several filters at once.
- **Export** the current sorted/filtered view to `.xlsx` or `.csv`.

## Run it

Requires Python 3.9+ (`openpyxl` is the only extra component; the launcher installs it for you).

### One-click start (no terminal needed)

1. Install Python 3.9+ from python.org — **on Windows tick "Add Python to PATH"**.
2. Double-click the launcher for your system, inside the `rectrack` folder:

   | System | File to double-click |
   |---|---|
   | Windows | `Start Rectification Tracker.bat` |
   | macOS | `Start Rectification Tracker.command` |
   | Linux | `Start Rectification Tracker.sh` (or add `Rectification Tracker.desktop` to your desktop) |

It starts the server and opens the tracker in your browser automatically.
A small console window stays open — close it (or press Ctrl+C) to stop the tracker.

> macOS: the first time, right-click the `.command` file → **Open** to get past Gatekeeper.

### From a terminal (alternative)

```bash
cd rectrack
./run.sh            # or: ./run.sh 8020
```

Manual start on any OS:

```bash
cd rectrack
python3 -m pip install -r requirements.txt
python3 launcher.py
```

Then open the URL it prints (default <http://127.0.0.1:8010>).

## Where your data lives

Everything is stored under `rectrack/data/`:

- `rectrack.db` — the SQLite database (all items, imports, photo links)
- `photos/` — copies of all attached images

**Back this folder up regularly** (e.g. copy it to GitHub/OneDrive). Deleting it
resets the app. The database keeps growing safely for the whole 4+ months.

## Excel import format

Uses the same template as `A Guide to handover inspection for Hospital End-Users.xlsm`:
the header row must contain `Item No.`, `SoA`, `Room`, `Priority Level`,
`Type of Issue`, `General Category`, `Details Description`,
`Photo Reference Number`, `Expected Completion Date`, `Rectification Status`.
