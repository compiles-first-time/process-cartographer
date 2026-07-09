"""Loom destructive-action guard — Python evaluator (ADR-0049/0050, Phase 3).

The cross-language proof: this is a thin re-implementation of the SAME tier logic
as scripts/lib/destructive-guard.mjs, reading the SAME policy data
(spec/policy/destructive-actions.policy.json). One policy, two languages — that
is language-neutral portability (the JS host reuses the JS evaluator; a Python
host uses this one). Verified by adapters/python/conformance_check.py against the
shared spec/conformance/scenarios.json.

Pure + dependency-free (stdlib only). Run:  python conformance_check.py
"""

import json
import os
import re

_DIR = os.path.dirname(os.path.abspath(__file__))
_POLICY_PATH = os.path.normpath(
    os.path.join(_DIR, "..", "..", "spec", "policy", "destructive-actions.policy.json")
)

_FORCE_PUSH_RE = re.compile(
    r"\bgit\s+push\b[^\n]*?(?:--force\b|--force-with-lease\b|-f\b)", re.IGNORECASE
)
# Same char class as the JS CONTAINED_PREFIX: start | whitespace/quote/paren/eq | slash
_CONTAINED_PREFIX = "(?:^|[\\s\"'`(=]|/)"
# A command with shell chaining/substitution/comments is NOT eligible for a
# contained-scope downgrade — its destructive target may be outside the worktree
# even if ".worktrees/" appears elsewhere. Mirrors the JS guard. Falls to `ask`.
_CHAINED_OR_COMMENT = re.compile(r"&&|\|\||[;|&\n#]|\$\(|`")


def load_policy(path=_POLICY_PATH):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _norm(p):
    return p.replace("\\", "/") if isinstance(p, str) else ""


def _extract_file_path(inp):
    if isinstance(inp, dict) and isinstance(inp.get("file_path"), str):
        return inp["file_path"]
    return ""


def _extract_command(inp):
    if isinstance(inp, str):
        return inp
    if isinstance(inp, dict):
        for f in ("command", "Command", "script"):
            if isinstance(inp.get(f), str):
                return inp[f]
    return ""


def _path_matches_any(file_path, rel_list):
    norm = _norm(file_path)
    if not norm:
        return None
    for rel in rel_list or []:
        if norm == rel or norm.endswith("/" + rel):
            return rel
    return None


def _build_protected_re(branches):
    if not branches:
        return None
    return re.compile(r"\b(?:" + "|".join(re.escape(b) for b in branches) + r")\b", re.IGNORECASE)


def _build_contained_re(segments):
    if not segments:
        return None
    return re.compile(_CONTAINED_PREFIX + "(?:" + "|".join(re.escape(s) for s in segments) + ")")


def decide(tool="", input=None, hits=None, policy=None):
    """Return the tier decision: 'deny' | 'ask' | 'allow' | 'none'."""
    if policy is None:
        policy = load_policy()
    hits = hits or []
    file_path = _extract_file_path(input)
    command = _extract_command(input)
    is_edit = tool in ("Edit", "Write", "NotebookEdit", "MultiEdit")

    # Tier 1 — deny: immutable / hook-managed files, force-push to protected branch.
    if is_edit and file_path:
        if _path_matches_any(file_path, policy.get("immutableFiles")):
            return "deny"
        if _path_matches_any(file_path, policy.get("hookManagedFiles")):
            return "deny"
    protected_re = _build_protected_re(policy.get("protectedBranches", []))
    if command and _FORCE_PUSH_RE.search(command) and protected_re and protected_re.search(command):
        return "deny"
    for h in hits:
        if h and h.get("decision") == "deny":
            return "deny"

    # Destructive signal?
    signal = None
    for h in hits:
        if h and (h.get("category") == "destructive_actions" or h.get("decision") in ("ask", "deny")):
            signal = h
            break
    if signal is None:
        return "none"

    # Tier 3 — contained scope (best-effort ask->allow; never a deny bypass).
    contained_re = _build_contained_re(policy.get("containedScopeSegments", []))
    if contained_re:
        if file_path and contained_re.search(_norm(file_path)):
            return "allow"
        if command and not _CHAINED_OR_COMMENT.search(command) and contained_re.search(_norm(command)):
            return "allow"

    # Tier 2 — the destructive class.
    return policy.get("destructiveDefault", "ask")
