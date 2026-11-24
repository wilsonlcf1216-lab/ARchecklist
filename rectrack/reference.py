"""Controlled vocabularies extracted from the handover inspection template.

These drive the dropdowns in the UI and keep incoming Excel data normalised.
"""

# Priority Level  (data validation  D9:D608  ->  "1, 2, 3, 4")
PRIORITY_LEVELS = ["1", "2", "3", "4"]

# Type of Issue  (data validation  E9:E608)
ISSUE_TYPES = [
    "Defect",
    "Incomplete works",
    "Maintenance concern",
    "Design change request",
]

# Rectification Status (chosen workflow)
STATUSES = ["Not started", "In progress", "Completed", "Verified"]

# General Category  (sheet "\u5de5\u4f5c\u88682" cols T/U)
GENERAL_CATEGORY_GROUPS = {
    "Architectural": [
        "Ceiling",
        "Floor",
        "Wall Finishes",
        "Door Hardware",
        "Window and Glazing",
        "Fixtures",
        "Toilet and Sanitary Fitment",
        "General Wet Areas",
        "Signage",
    ],
    "Building Services": [
        "Mechanical Ventilation and Air Conditioning",
        "Electrical Installation",
        "Fire Service Installation",
        "Plumbing and Drainage Installation",
        "Medical Gas Installation",
    ],
}
GENERAL_CATEGORIES = [c for group in GENERAL_CATEGORY_GROUPS.values() for c in group]

# SoA = Schedule of Accommodation (room / area type), sheet "\u5de5\u4f5c\u88682" cols A-F
SOA_GROUPS = {
    "Patient Area": [
        "1-Bed Isolation Room",
        "2-Bed Room",
        "4-Bed Room",
        "8-Bed Room",
        "End of Life Room",
        "Ante-Room",
    ],
    "Toilet / Shower": [
        "Ensuite Toilet",
        "Anteroom",
        "Patient Lavatory",
        "Patient Accessible Toilet",
        "Staff Lavatory (M)",
        "Staff Lavatory (F)",
        "Staff Shower",
        "Emergency Shower",
    ],
    "Staff Area": [
        "Nurse Station",
        "Satellite Station",
        "Treatment Room",
        "Day Room",
        "Interview Room",
        "WM Office",
        "APN/NO Office",
    ],
    "Store": [
        "Linen",
        "Med/Consum/Stationary",
        "Med/IV Room",
        "Equipment Parking",
        "PPE",
    ],
    "Supporting Area": [
        "Clean Utility",
        "Dirty Utility",
        "Assisted Bath",
        "Meal Preparation Room",
        "Gown-up Room",
        "Gown-down Room",
        "ALC-Gown Up",
        "ALC-Gown Down",
        "Cleaner's Room",
        "Refuse & Soiled Linen Room",
    ],
}
SOAS = [c for group in SOA_GROUPS.values() for c in group]

# Spelling variants found in the source workbook -> canonical value
_CATEGORY_ALIASES = {
    "architetural": "Architectural",
    "architectural": "Architectural",
    "building_services": "Building Services",
    "building services": "Building Services",
}
_SOA_ALIASES = {
    "patient_accessible_toilet": "Patient Accessible Toilet",
    "satelliate station": "Satellite Station",
}
_STATUS_ALIASES = {
    "not started": "Not started",
    "notstarted": "Not started",
    "open": "Not started",
    "in progress": "In progress",
    "inprogress": "In progress",
    "wip": "In progress",
    "completed": "Completed",
    "complete": "Completed",
    "done": "Completed",
    "verified": "Verified",
    "closed": "Verified",
}


def normalise_category(value):
    if not value:
        return ""
    v = str(value).strip()
    canon = _CATEGORY_ALIASES.get(v.lower(), v)
    for c in GENERAL_CATEGORIES:
        if c.lower() == canon.lower():
            return c
    return canon


def normalise_soa(value):
    if not value:
        return ""
    v = str(value).strip()
    canon = _SOA_ALIASES.get(v.lower(), v)
    for c in SOAS:
        if c.lower() == canon.lower():
            return c
    return canon


def normalise_status(value):
    if not value:
        return "Not started"
    v = str(value).strip()
    canon = _STATUS_ALIASES.get(v.lower())
    if canon:
        return canon
    for c in STATUSES:
        if c.lower() == v.lower():
            return c
    return v


def reference_payload():
    return {
        "priority_levels": PRIORITY_LEVELS,
        "issue_types": ISSUE_TYPES,
        "statuses": STATUSES,
        "general_category_groups": GENERAL_CATEGORY_GROUPS,
        "soa_groups": SOA_GROUPS,
    }
