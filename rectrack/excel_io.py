"""Excel import (from the standard handover template) and export."""
import io
import re
from datetime import date, datetime

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

import reference

# Template header (row 8 of "Slag List") -> internal field name.
HEADER_MAP = {
    "item no": "item_no",
    "item no.": "item_no",
    "soa": "soa",
    "room": "room",
    "room (e.g. 6-beds cubicle)": "room",
    "priority level": "priority",
    "type of issue": "issue_type",
    "general category": "general_category",
    "details description": "description",
    "photo reference number": "photo_ref",
    "expected completion date": "expected_completion_date",
    "rectification status": "status",
}

EXPORT_COLUMNS = [
    ("Item No.", "item_no"),
    ("SoA", "soa"),
    ("Room", "room"),
    ("Priority Level", "priority"),
    ("Type of Issue", "issue_type"),
    ("General Category", "general_category"),
    ("Details Description", "description"),
    ("Photo Reference Number", "photo_ref"),
    ("Expected Completion Date", "expected_completion_date"),
    ("Rectification Status", "status"),
    ("Completed Date", "completed_date"),
    ("Verified Date", "verified_date"),
    ("Floor", "floor"),
    ("Ward/Unit", "ward_unit"),
    ("Source File", "source_file"),
]

META_LABELS = {
    "project": "project",
    "prepared by": "prepared_by",
    "date": "inspection_date",
    "floor": "floor",
    "ward/unit": "ward_unit",
    "ward / unit": "ward_unit",
    "wardunit": "ward_unit",
}


def _norm(text):
    if text is None:
        return ""
    return re.sub(r"\s+", " ", str(text)).strip().lower()


def _clean_cell(value):
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def parse_workbook(path_or_bytes, filename=""):
    """Return (meta, rows) parsed from a standard handover inspection file."""
    if isinstance(path_or_bytes, (bytes, bytearray)):
        wb = load_workbook(io.BytesIO(path_or_bytes), data_only=True)
    else:
        wb = load_workbook(path_or_bytes, data_only=True)

    # pick the "Slag List" sheet, else first sheet
    ws = None
    for name in wb.sheetnames:
        if _norm(name) in ("slag list", "slaglist"):
            ws = wb[name]
            break
    if ws is None:
        ws = wb[wb.sheetnames[0]]

    meta = {"filename": filename, "project": "", "prepared_by": "",
            "inspection_date": "", "floor": "", "ward_unit": ""}

    header_row_idx = None
    header_map = {}

    for r_idx, row in enumerate(ws.iter_rows(values_only=True), 1):
        label = _norm(row[0]).rstrip(":") if row else ""
        # metadata block (label in col A, value in col B) before the header row
        if label in META_LABELS and header_row_idx is None:
            key = META_LABELS[label]
            value = _clean_cell(row[1]) if len(row) > 1 else ""
            if value and not meta.get(key):
                meta[key] = value
            continue
        # locate the header row: contains both "item no" and "priority level"
        cells = [_norm(c) for c in row]
        if "item no" in cells or ("priority level" in cells and "soa" in cells):
            header_row_idx = r_idx
            used_fields = set()
            for col_idx, cell in enumerate(cells):
                if not cell:
                    continue
                field = HEADER_MAP.get(cell)
                if not field:
                    for key, val in HEADER_MAP.items():
                        if cell.startswith(key):
                            field = val
                            break
                if field and field not in used_fields:
                    header_map[col_idx] = field
                    used_fields.add(field)
            break

    if header_row_idx is None:
        raise ValueError(
            "Could not find the header row. Expected a row containing "
            "'Item No.' and 'Priority Level' (the standard 'Slag List' template).")

    rows = []
    for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
        if row is None:
            continue
        record = {}
        for col_idx, field in header_map.items():
            record[field] = _clean_cell(row[col_idx]) if col_idx < len(row) else ""
        # skip fully empty data rows
        if not any(record.get(f) for f in ("soa", "room", "priority", "issue_type",
                                           "general_category", "description",
                                           "photo_ref", "expected_completion_date")):
            continue
        record["floor"] = meta.get("floor", "")
        record["ward_unit"] = meta.get("ward_unit", "")
        rows.append(record)

    return meta, rows


def export_xlsx(rows, title="Rectification Tracker"):
    wb = Workbook()
    ws = wb.active
    ws.title = "Rectification List"

    title_font = Font(bold=True, size=13)
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1F4E79")
    wrap = Alignment(vertical="top", wrap_text=True)

    ws.cell(row=1, column=1, value=title).font = title_font
    ws.cell(row=2, column=1, value="Exported: " + datetime.now().strftime("%Y-%m-%d %H:%M"))

    header_r = 4
    for c_idx, (label, _field) in enumerate(EXPORT_COLUMNS, 1):
        cell = ws.cell(row=header_r, column=c_idx, value=label)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = wrap

    for r_off, item in enumerate(rows):
        for c_idx, (_label, field) in enumerate(EXPORT_COLUMNS, 1):
            ws.cell(row=header_r + 1 + r_off, column=c_idx, value=item.get(field, ""))

    widths = [8, 22, 20, 10, 18, 24, 50, 20, 18, 16, 14, 14, 12, 14, 24]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = ws.cell(row=header_r + 1, column=1)
    ws.auto_filter.ref = f"A{header_r}:{get_column_letter(len(EXPORT_COLUMNS))}{header_r + len(rows)}"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def export_csv(rows):
    import csv
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([label for label, _ in EXPORT_COLUMNS])
    for item in rows:
        writer.writerow([item.get(field, "") for _label, field in EXPORT_COLUMNS])
    return buf.getvalue()
