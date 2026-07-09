"""Credit-validation pipeline — a small project built ON Loom (the dogfood).

Mirrors the Credit-Validation Requirements & Exceptions xlsx: read a CSV of
records, validate headers + data presence + per-field correctness, produce a
report, and handle Business Exceptions (bad data) and System Exceptions (I/O /
parse failures). A cleanup step is GOVERNED by the Loom Python guard — showing
Loom's policy enforcing a real app's destructive action, model-independently.

Stdlib only. Run via validate_test.py (which also registers this pipeline's
BR/BE/SE into the Loom registry).
"""

import csv
import os
import re
import sys

REQUIRED_HEADERS = ["name", "email", "amount", "card_last4"]
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CARD_RE = re.compile(r"^\d{4}$")


def find_root(start):
    d = os.path.abspath(start)
    for _ in range(8):
        if os.path.exists(os.path.join(d, "CLAUDE.md")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return os.path.abspath(start)


# Import the Loom Python guard (a real project would pip-install / vendor it).
_ROOT = find_root(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(_ROOT, "adapters", "python"))
from loom_guard import decide  # noqa: E402


def validate_row(row):
    """Return a list of Business-Exception strings for one record (empty = valid)."""
    problems = []
    if not (row.get("name") or "").strip():
        problems.append("BE: name is empty")
    if not _EMAIL_RE.match((row.get("email") or "").strip()):
        problems.append(f"BE: invalid email {row.get('email')!r}")
    amount = (row.get("amount") or "").strip()
    try:
        if float(amount) <= 0:
            problems.append(f"BE: non-positive amount {amount!r}")
    except ValueError:
        problems.append(f"BE: invalid amount {amount!r}")
    if not _CARD_RE.match((row.get("card_last4") or "").strip()):
        problems.append(f"BE: invalid card_last4 {row.get('card_last4')!r}")
    return problems


def validate_file(path):
    """Validate a credit CSV. Returns a report dict; never raises for expected
    Business/System exceptions — it records them (the RPA discipline)."""
    report = {"path": path, "ok": False, "valid_rows": 0, "discrepancies": [],
              "business_exceptions": [], "system_exceptions": []}

    # System exceptions: file missing / unreadable / undecodable / unparseable.
    try:
        with open(path, "r", encoding="utf-8", newline="") as f:
            text = f.read()
    except FileNotFoundError:
        report["system_exceptions"].append(f"SE: file not found: {path}")
        return report
    except (OSError, UnicodeDecodeError) as e:
        report["system_exceptions"].append(f"SE: unreadable/undecodable file: {e}")
        return report

    try:
        reader = csv.DictReader(text.splitlines())
        headers = reader.fieldnames or []  # available even when there are no data rows
        rows = list(reader)
    except csv.Error as e:
        report["system_exceptions"].append(f"SE: CSV parse error: {e}")
        return report

    # Business exceptions at the file level.
    missing = [h for h in REQUIRED_HEADERS if h not in headers]
    if missing:
        report["business_exceptions"].append(f"BE: missing required header(s): {missing}")
        return report
    if len(rows) == 0:
        report["business_exceptions"].append("BE: no data rows")
        return report

    # Per-row business exceptions.
    for i, row in enumerate(rows, start=2):  # start=2: header is line 1
        problems = validate_row(row)
        if problems:
            report["discrepancies"].append({"line": i, "problems": problems})
        else:
            report["valid_rows"] += 1

    report["ok"] = len(report["discrepancies"]) == 0
    return report


def governed_cleanup(target):
    """Demonstrate Loom governance inside a real app: before a destructive
    cleanup, consult the guard. Returns (decision, did_delete)."""
    hits = [{"category": "destructive_actions", "matched_on": "rm -rf", "decision": "ask"}]
    decision = decide(tool="Bash", input={"command": f"rm -rf {target}"}, hits=hits)
    # Respect the gate: only auto-proceed when the guard says "allow"
    # (e.g. inside a .worktrees/ scratch); otherwise defer to a human.
    did_delete = decision == "allow"
    return decision, did_delete
