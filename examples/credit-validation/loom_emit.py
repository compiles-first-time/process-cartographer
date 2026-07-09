"""Emit test_case events into the Loom registry from Python (the dogfood proves
the registry is cross-language: a Python app registers its requirements/exceptions
into the same event log the JS suite writes, and the Observatory renders them).

Mirrors scripts/lib/testcase.mjs + hooks/_lib.mjs mechanicalRecord — same schema,
same UTC-dated JSONL path, so the aggregator upserts these rows by id.
"""

import datetime
import json
import os


def _utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def emit_test_case(root, case):
    log_dir = os.path.join(root, "memory", "event-log")
    os.makedirs(log_dir, exist_ok=True)
    day = _utc_now().strftime("%Y-%m-%d")
    record = {
        "timestamp": _utc_now().isoformat().replace("+00:00", "Z"),
        "session_id": os.environ.get("CLAUDE_SESSION_ID", "credit-validation-dogfood"),
        "cwd": root,
        "event_type": "test_case",
        "kernel_version": "v6",
        "loom_version": "0.2.0",
        "id": case.get("id"),
        "parent_id": case.get("parent_id"),
        "type": case.get("type", "---"),
        "title": case.get("title", ""),
        "framework_location": case.get("framework_location"),
        "expected_input": case.get("expected_input"),
        "expected_output": case.get("expected_output"),
        "actual_input": case.get("actual_input"),
        "actual_output": case.get("actual_output"),
        "status": case.get("status", "pending"),
        "justification": case.get("justification", ""),
    }
    with open(os.path.join(log_dir, day + ".jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    return True
