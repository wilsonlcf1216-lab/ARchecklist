"""SQLite storage layer for the rectification tracker."""
import os
import sqlite3
import threading
from datetime import datetime

import reference

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "rectrack.db")
PHOTO_DIR = os.path.join(DATA_DIR, "photos")

# Columns that may be used for filtering / sorting from the UI.
SORTABLE_COLUMNS = [
    "item_no", "soa", "room", "priority", "issue_type", "general_category",
    "description", "photo_ref", "expected_completion_date", "status",
    "completed_date", "verified_date", "source_file", "floor", "ward_unit", "id",
]
FILTERABLE_COLUMNS = [
    "soa", "room", "priority", "issue_type", "general_category", "status",
    "source_file", "floor", "ward_unit", "photo_ref",
]

_local = threading.local()


def _connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(PHOTO_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def conn():
    """One connection per thread (http.server is threaded)."""
    c = getattr(_local, "conn", None)
    if c is None:
        c = _connect()
        _local.conn = c
    return c


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


SCHEMA = """
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    project TEXT,
    prepared_by TEXT,
    inspection_date TEXT,
    floor TEXT,
    ward_unit TEXT,
    row_count INTEGER,
    imported_at TEXT
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER,
    source_file TEXT,
    item_no TEXT,
    soa TEXT,
    room TEXT,
    priority TEXT,
    issue_type TEXT,
    general_category TEXT,
    description TEXT,
    photo_ref TEXT,
    expected_completion_date TEXT,
    status TEXT DEFAULT 'Not started',
    completed_date TEXT,
    verified_date TEXT,
    remarks TEXT,
    floor TEXT,
    ward_unit TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    filename TEXT,
    kind TEXT,
    uploaded_at TEXT,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_priority ON items(priority);
CREATE INDEX IF NOT EXISTS idx_photos_item ON photos(item_id);
"""


def init_db():
    c = conn()
    c.executescript(SCHEMA)
    c.commit()


# ---------------------------------------------------------------- items ----

def insert_item(data, c=None):
    c = c or conn()
    ts = now()
    fields = dict(
        import_id=data.get("import_id"),
        source_file=data.get("source_file") or "",
        item_no=data.get("item_no") or "",
        soa=reference.normalise_soa(data.get("soa")),
        room=data.get("room") or "",
        priority=(data.get("priority") or "").strip(),
        issue_type=data.get("issue_type") or "",
        general_category=reference.normalise_category(data.get("general_category")),
        description=data.get("description") or "",
        photo_ref=data.get("photo_ref") or "",
        expected_completion_date=data.get("expected_completion_date") or "",
        status=reference.normalise_status(data.get("status")),
        remarks=data.get("remarks") or "",
        floor=data.get("floor") or "",
        ward_unit=data.get("ward_unit") or "",
        created_at=ts,
        updated_at=ts,
    )
    cols = ", ".join(fields)
    ph = ", ".join("?" for _ in fields)
    cur = c.execute(f"INSERT INTO items ({cols}) VALUES ({ph})", list(fields.values()))
    return cur.lastrowid


def update_item(item_id, data, c=None):
    c = c or conn()
    allowed = {
        "item_no", "soa", "room", "priority", "issue_type", "general_category",
        "description", "photo_ref", "expected_completion_date", "status",
        "remarks", "floor", "ward_unit",
    }
    sets, vals = [], []
    for k, v in data.items():
        if k not in allowed:
            continue
        if k == "soa":
            v = reference.normalise_soa(v)
        if k == "general_category":
            v = reference.normalise_category(v)
        if k == "status":
            v = reference.normalise_status(v)
        sets.append(f"{k} = ?")
        vals.append(v if v is not None else "")
    if not sets:
        return False
    vals.append(now())
    vals.append(item_id)
    c.execute(f"UPDATE items SET {', '.join(sets)}, updated_at = ? WHERE id = ?", vals)
    _sync_status_dates(item_id, c)
    c.commit()
    return True


def _sync_status_dates(item_id, c):
    """Set/clear completed_date and verified_date based on current status."""
    row = c.execute("SELECT status, completed_date, verified_date FROM items WHERE id=?",
                    (item_id,)).fetchone()
    if row is None:
        return
    status = row["status"]
    completed = row["completed_date"]
    verified = row["verified_date"]
    changed = False
    if status in ("Completed", "Verified") and not completed:
        completed = now()[:10]
        changed = True
    if status in ("Not started", "In progress") and completed:
        completed = None
        changed = True
    if status == "Verified" and not verified:
        verified = now()[:10]
        changed = True
    if status != "Verified" and verified:
        verified = None
        changed = True
    if changed:
        c.execute("UPDATE items SET completed_date=?, verified_date=? WHERE id=?",
                  (completed, verified, item_id))


def set_status(item_id, status, c=None):
    c = c or conn()
    c.execute("UPDATE items SET status=?, updated_at=? WHERE id=?",
              (reference.normalise_status(status), now(), item_id))
    _sync_status_dates(item_id, c)
    c.commit()


def delete_item(item_id, c=None):
    c = c or conn()
    c.execute("DELETE FROM items WHERE id=?", (item_id,))
    c.commit()


def _build_where(filters, q):
    clauses, params = [], []
    for key, value in (filters or {}).items():
        if key not in FILTERABLE_COLUMNS:
            continue
        if value in (None, ""):
            continue
        if isinstance(value, (list, tuple)):
            if not value:
                continue
            placeholders = ", ".join("?" for _ in value)
            clauses.append(f"{key} IN ({placeholders})")
            params.extend(value)
        else:
            clauses.append(f"{key} = ?")
            params.append(value)
    if q:
        like = f"%{q}%"
        text_cols = ["description", "room", "photo_ref", "item_no", "remarks"]
        clauses.append("(" + " OR ".join(f"{col} LIKE ?" for col in text_cols) + ")")
        params.extend([like] * len(text_cols))
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


def query_items(filters=None, q=None, sort=None, direction=None, limit=None, offset=None):
    c = conn()
    where, params = _build_where(filters, q)

    order = []
    if sort:
        dirs = direction or []
        for i, col in enumerate(sort):
            if col not in SORTABLE_COLUMNS:
                continue
            d = "DESC" if (i < len(dirs) and str(dirs[i]).lower() == "desc") else "ASC"
            # keep priority/status natural-ish: priority sorts numerically
            if col == "priority":
                order.append(f"CAST(NULLIF(priority,'') AS INTEGER) {d}")
            else:
                order.append(f"{col} {d}")
    if not order:
        order.append("id ASC")
    sql = f"SELECT * FROM items{where} ORDER BY {', '.join(order)}"
    args = list(params)
    if limit is not None:
        sql += " LIMIT ?"
        args.append(int(limit))
        if offset:
            sql += " OFFSET ?"
            args.append(int(offset))
    rows = [dict(r) for r in c.execute(sql, args).fetchall()]
    return rows


def count_items(filters=None, q=None):
    c = conn()
    where, params = _build_where(filters, q)
    return c.execute(f"SELECT COUNT(*) AS n FROM items{where}", params).fetchone()["n"]


def get_item(item_id):
    c = conn()
    row = c.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    return dict(row) if row else None


def distinct_values(column):
    if column not in FILTERABLE_COLUMNS:
        return []
    c = conn()
    rows = c.execute(
        f"SELECT DISTINCT {column} AS v FROM items WHERE {column} IS NOT NULL AND {column} != '' ORDER BY {column}"
    ).fetchall()
    return [r["v"] for r in rows]


def summary():
    c = conn()
    by_status = {r["status"] or "(blank)": r["n"] for r in c.execute(
        "SELECT status, COUNT(*) AS n FROM items GROUP BY status")}
    by_priority = {r["priority"] or "(blank)": r["n"] for r in c.execute(
        "SELECT priority, COUNT(*) AS n FROM items GROUP BY priority")}
    overdue = c.execute(
        "SELECT COUNT(*) AS n FROM items WHERE expected_completion_date != '' "
        "AND expected_completion_date IS NOT NULL AND status NOT IN ('Completed','Verified') "
        "AND expected_completion_date < ?", (now()[:10],)).fetchone()["n"]
    total = c.execute("SELECT COUNT(*) AS n FROM items").fetchone()["n"]
    return {
        "total": total,
        "by_status": by_status,
        "by_priority": by_priority,
        "overdue": overdue,
    }


# --------------------------------------------------------------- photos ----

def add_photo(item_id, filename, kind="", c=None):
    c = c or conn()
    cur = c.execute(
        "INSERT INTO photos (item_id, filename, kind, uploaded_at) VALUES (?,?,?,?)",
        (item_id, filename, kind, now()))
    c.commit()
    return cur.lastrowid


def photos_for(item_id):
    c = conn()
    return [dict(r) for r in c.execute(
        "SELECT * FROM photos WHERE item_id=? ORDER BY id", (item_id,)).fetchall()]


def photos_for_many(item_ids):
    if not item_ids:
        return {}
    c = conn()
    placeholders = ", ".join("?" for _ in item_ids)
    rows = c.execute(
        f"SELECT * FROM photos WHERE item_id IN ({placeholders}) ORDER BY id", item_ids).fetchall()
    out = {}
    for r in rows:
        out.setdefault(r["item_id"], []).append(dict(r))
    return out


def delete_photo(photo_id, c=None):
    c = c or conn()
    row = c.execute("SELECT filename FROM photos WHERE id=?", (photo_id,)).fetchone()
    c.execute("DELETE FROM photos WHERE id=?", (photo_id,))
    c.commit()
    return row["filename"] if row else None


# -------------------------------------------------------------- imports ----

def insert_import(meta, row_count, c=None):
    c = c or conn()
    cur = c.execute(
        "INSERT INTO imports (filename, project, prepared_by, inspection_date, floor, "
        "ward_unit, row_count, imported_at) VALUES (?,?,?,?,?,?,?,?)",
        (meta.get("filename"), meta.get("project"), meta.get("prepared_by"),
         meta.get("inspection_date"), meta.get("floor"), meta.get("ward_unit"),
         row_count, now()))
    c.commit()
    return cur.lastrowid


def list_imports():
    c = conn()
    return [dict(r) for r in c.execute(
        "SELECT * FROM imports ORDER BY id DESC").fetchall()]
