"""grimp_oracle — the Python side of the B2 differential (ADR-0055 §B.5).

Builds a static import graph of every top-level package in the given tree with
grimp (the engine behind import-linter; AST-based, no code execution) and
prints file->file edges as JSON:

    {"packages": ["swarm"], "edges": [["swarm/core.py", "swarm/util.py"], ...]}

Exit codes: 0 ok; 3 grimp not installed (stderr contains GRIMP_NOT_INSTALLED).
"""

import json
import os
import sys

try:
    import grimp
except ImportError:
    print("GRIMP_NOT_INSTALLED", file=sys.stderr)
    sys.exit(3)


def module_file(root: str, module: str):
    """Dotted module name -> repo-relative file path, or None (namespace pkg etc.)."""
    base = os.path.join(root, *module.split("."))
    if os.path.isfile(base + ".py"):
        return "/".join(module.split(".")) + ".py"
    init = os.path.join(base, "__init__.py")
    if os.path.isfile(init):
        return "/".join(module.split(".")) + "/__init__.py"
    return None


def main() -> None:
    root = sys.argv[1]
    sys.path.insert(0, root)

    packages = sorted(
        entry
        for entry in os.listdir(root)
        if os.path.isdir(os.path.join(root, entry))
        and os.path.isfile(os.path.join(root, entry, "__init__.py"))
    )
    if not packages:
        print(json.dumps({"packages": [], "edges": []}))
        return

    graph = grimp.build_graph(*packages, include_external_packages=False)
    edges = set()
    module_files = set()
    for module in graph.modules:
        src = module_file(root, module)
        if src is None:
            continue
        module_files.add(src)
        for imported in graph.find_modules_directly_imported_by(module):
            dst = module_file(root, imported)
            if dst is not None and dst != src:
                edges.add((src, dst))

    # module_files = grimp's model scope: importable package modules only.
    # Script files without an __init__.py chain are OUTSIDE what grimp can
    # affirm or deny — the harness restricts the comparison to this scope and
    # discloses everything outside it (triaged 2026-07-18: those edges were
    # spot-verified real; the blind spot is the oracle's, not the resolver's).
    print(json.dumps({"packages": packages, "module_files": sorted(module_files), "edges": sorted(edges)}))


if __name__ == "__main__":
    main()
