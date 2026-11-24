"""Rectification Tracker - local web server (Python standard library only).

Run:  python3 server.py [--port 8010]
Then open http://127.0.0.1:8010 in your browser.
"""
import argparse
import base64
import json
import mimetypes
import os
import posixpath
import re
import shutil
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db
import excel_io
import reference

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff"}


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = "Rectrack/1.0"

    # ----------------------------------------------------------- helpers --
    def log_message(self, fmt, *args):
        print("[rectrack] " + (fmt % args))

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, body, content_type, filename=None, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            raise ApiError("Invalid JSON body")

    def _parse_query(self):
        parsed = urllib.parse.urlparse(self.path)
        return parsed.path, urllib.parse.parse_qs(parsed.query, keep_blank_values=False)

    # ------------------------------------------------------------- GET ----
    def do_GET(self):
        try:
            path, qs = self._parse_query()
            if path.startswith("/api/"):
                self._handle_api_get(path, qs)
            elif path.startswith("/photos/"):
                self._serve_photo(path)
            elif path == "/" or path == "/index.html":
                self._serve_static("index.html")
            elif path.startswith("/static/"):
                self._serve_static(path[len("/static/"):])
            else:
                self._json({"error": "Not found"}, 404)
        except ApiError as e:
            self._json({"error": e.message}, e.status)
        except Exception as e:  # noqa: BLE001
            self.log_message("ERROR %s", e)
            self._json({"error": str(e)}, 500)

    def _filters_from_qs(self, qs):
        filters = {}
        for key, values in qs.items():
            if key.startswith("f_"):
                col = key[2:]
                filters[col] = values if len(values) > 1 else values[0]
        return filters

    def _list_params(self, qs):
        filters = self._filters_from_qs(qs)
        q = (qs.get("q") or [""])[0]
        sort = (qs.get("sort") or [""])[0]
        direction = (qs.get("dir") or [""])[0]
        sort_cols = [s for s in sort.split(",") if s]
        dirs = [d for d in direction.split(",") if d]
        return filters, q, sort_cols, dirs

    def _handle_api_get(self, path, qs):
        if path == "/api/reference":
            return self._json(reference.reference_payload())
        if path == "/api/summary":
            return self._json(db.summary())
        if path == "/api/imports":
            return self._json(db.list_imports())
        if path == "/api/facets":
            facets = {col: db.distinct_values(col) for col in db.FILTERABLE_COLUMNS}
            return self._json(facets)
        if path == "/api/items":
            filters, q, sort_cols, dirs = self._list_params(qs)
            limit = (qs.get("limit") or [None])[0]
            offset = (qs.get("offset") or [None])[0]
            rows = db.query_items(filters, q, sort_cols, dirs,
                                  limit=int(limit) if limit else None,
                                  offset=int(offset) if offset else None)
            if (qs.get("with_photos") or ["0"])[0] == "1":
                pmap = db.photos_for_many([r["id"] for r in rows])
                for r in rows:
                    r["photos"] = pmap.get(r["id"], [])
            total = db.count_items(filters, q)
            return self._json({"items": rows, "total": total})
        if path == "/api/export.xlsx":
            filters, q, sort_cols, dirs = self._list_params(qs)
            rows = db.query_items(filters, q, sort_cols, dirs)
            buf = excel_io.export_xlsx(rows)
            return self._bytes(buf.read(),
                               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                               "rectification_export.xlsx")
        if path == "/api/export.csv":
            filters, q, sort_cols, dirs = self._list_params(qs)
            rows = db.query_items(filters, q, sort_cols, dirs)
            csv = excel_io.export_csv(rows)
            return self._bytes(csv.encode("utf-8-sig"), "text/csv; charset=utf-8",
                               "rectification_export.csv")
        m = re.match(r"^/api/items/(\d+)$", path)
        if m:
            item = db.get_item(int(m.group(1)))
            if not item:
                raise ApiError("Item not found", 404)
            item["photos"] = db.photos_for(item["id"])
            return self._json(item)
        raise ApiError("Not found", 404)

    # ----------------------------------------------------- POST/PUT/DEL ---
    def do_POST(self):
        try:
            path, _qs = self._parse_query()
            body = self._read_json()
            if path == "/api/items":
                new_id = db.insert_item(body)
                db.conn().commit()
                return self._json({"id": new_id}, 201)
            if path == "/api/import":
                return self._json(self._handle_import(body))
            if path == "/api/photos/scan":
                return self._json(self._scan_photos(body))
            m = re.match(r"^/api/items/(\d+)/photos$", path)
            if m:
                return self._json(self._upload_photo(int(m.group(1)), body), 201)
            m = re.match(r"^/api/items/(\d+)/status$", path)
            if m:
                db.set_status(int(m.group(1)), body.get("status", ""))
                return self._json({"ok": True})
            self._json({"error": "Not found"}, 404)
        except ApiError as e:
            self._json({"error": e.message}, e.status)
        except Exception as e:  # noqa: BLE001
            self.log_message("ERROR %s", e)
            self._json({"error": str(e)}, 500)

    def do_PUT(self):
        try:
            path, _qs = self._parse_query()
            body = self._read_json()
            m = re.match(r"^/api/items/(\d+)$", path)
            if m:
                ok = db.update_item(int(m.group(1)), body)
                if not ok:
                    raise ApiError("Item not found", 404)
                return self._json(db.get_item(int(m.group(1))))
            self._json({"error": "Not found"}, 404)
        except ApiError as e:
            self._json({"error": e.message}, e.status)
        except Exception as e:  # noqa: BLE001
            self.log_message("ERROR %s", e)
            self._json({"error": str(e)}, 500)

    def do_DELETE(self):
        try:
            path, _qs = self._parse_query()
            m = re.match(r"^/api/items/(\d+)$", path)
            if m:
                db.delete_item(int(m.group(1)))
                return self._json({"ok": True})
            m = re.match(r"^/api/photos/(\d+)$", path)
            if m:
                fname = db.delete_photo(int(m.group(1)))
                if fname:
                    _safe_remove(os.path.join(db.PHOTO_DIR, fname))
                return self._json({"ok": True})
            self._json({"error": "Not found"}, 404)
        except ApiError as e:
            self._json({"error": e.message}, e.status)
        except Exception as e:  # noqa: BLE001
            self.log_message("ERROR %s", e)
            self._json({"error": str(e)}, 500)

    # --------------------------------------------------------- business ---
    def _handle_import(self, body):
        filename = body.get("filename") or "uploaded.xlsm"
        data_b64 = body.get("content_base64")
        if not data_b64:
            raise ApiError("Missing file content")
        raw = base64.b64decode(data_b64)
        try:
            meta, rows = excel_io.parse_workbook(raw, filename)
        except Exception as e:  # noqa: BLE001
            raise ApiError(f"Could not read the Excel file: {e}")

        c = db.conn()
        import_id = db.insert_import(meta, len(rows), c)
        for row in rows:
            row["import_id"] = import_id
            row["source_file"] = filename
            row["floor"] = row.get("floor") or meta.get("floor", "")
            row["ward_unit"] = row.get("ward_unit") or meta.get("ward_unit", "")
            db.insert_item(row, c)
        c.commit()

        matched = 0
        library = (body.get("library_folder") or "").strip()
        if library:
            matched = self._auto_match_from_folder(library)

        return {"import_id": import_id, "filename": filename,
                "rows_imported": len(rows), "meta": meta, "photos_matched": matched}

    def _upload_photo(self, item_id, body):
        if not db.get_item(item_id):
            raise ApiError("Item not found", 404)
        data_b64 = body.get("content_base64")
        if not data_b64:
            raise ApiError("Missing image content")
        raw = base64.b64decode(data_b64)
        orig = os.path.basename(body.get("filename") or "photo")
        ext = os.path.splitext(orig)[1].lower() or ".jpg"
        stored = f"item{item_id}_{_slug(os.path.splitext(orig)[0])}{ext}"
        stored = _unique_name(stored, db.PHOTO_DIR)
        with open(os.path.join(db.PHOTO_DIR, stored), "wb") as fh:
            fh.write(raw)
        pid = db.add_photo(item_id, stored, body.get("kind") or "")
        return {"id": pid, "filename": stored}

    def _scan_photos(self, body):
        folder = (body.get("folder") or "").strip()
        if not folder or not os.path.isdir(folder):
            raise ApiError("Folder not found: " + folder)
        matched = self._auto_match_from_folder(folder)
        return {"photos_matched": matched}

    def _auto_match_from_folder(self, folder):
        """Copy images from a folder into the library and link them to items
        whose Photo Reference Number / Item No. appears in the file name."""
        images = []
        for root, _dirs, files in os.walk(folder):
            for fn in files:
                if os.path.splitext(fn)[1].lower() in IMAGE_EXTS:
                    images.append(os.path.join(root, fn))

        items = db.query_items()
        matched = 0
        existing = set()
        for it in items:
            for p in db.photos_for(it["id"]):
                existing.add(p["filename"])

        for img_path in images:
            stem = os.path.splitext(os.path.basename(img_path))[0]
            target_items = []
            for it in items:
                ref = (it.get("photo_ref") or "").strip()
                if ref and _ref_in_name(ref, stem):
                    target_items.append(it)
            for it in target_items:
                ext = os.path.splitext(img_path)[1].lower()
                stored = _unique_name(f"item{it['id']}_{_slug(stem)}{ext}", db.PHOTO_DIR)
                if stored in existing:
                    continue
                try:
                    shutil.copy2(img_path, os.path.join(db.PHOTO_DIR, stored))
                except OSError:
                    continue
                db.add_photo(it["id"], stored, "auto")
                existing.add(stored)
                matched += 1
        return matched

    # ----------------------------------------------------------- static ---
    def _serve_static(self, rel):
        rel = posixpath.normpath(rel).lstrip("/")
        full = os.path.join(STATIC_DIR, rel)
        if not os.path.abspath(full).startswith(os.path.abspath(STATIC_DIR)):
            return self._json({"error": "Forbidden"}, 403)
        if not os.path.isfile(full):
            return self._json({"error": "Not found"}, 404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as fh:
            self._bytes(fh.read(), ctype)

    def _serve_photo(self, path):
        name = os.path.basename(urllib.parse.unquote(path[len("/photos/"):]))
        full = os.path.join(db.PHOTO_DIR, name)
        if not os.path.isfile(full):
            return self._json({"error": "Not found"}, 404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as fh:
            self._bytes(fh.read(), ctype)


def _slug(text):
    text = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")
    return text[:60] or "file"


def _unique_name(name, folder):
    base, ext = os.path.splitext(name)
    candidate = name
    i = 1
    while os.path.exists(os.path.join(folder, candidate)):
        candidate = f"{base}_{i}{ext}"
        i += 1
    return candidate


def _ref_in_name(ref, stem):
    ref = ref.strip().lower()
    stem = stem.lower()
    if ref and ref in stem:
        return True
    # tolerate separators: "6.01" ~ "6-01" / "6_01" / "6 01"
    compact_ref = re.sub(r"[^a-z0-9]", "", ref)
    compact_stem = re.sub(r"[^a-z0-9]", "", stem)
    return bool(compact_ref) and compact_ref in compact_stem


def _safe_remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def main():
    parser = argparse.ArgumentParser(description="Rectification tracker server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()

    db.init_db()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}"
    print(f"Rectification Tracker running at {url}")
    print(f"Data: {db.DB_PATH}")
    print(f"Photos: {db.PHOTO_DIR}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
