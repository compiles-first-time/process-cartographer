# Procedural Skill Library

> Voyager-style skill-by-name registry. Each skill is a reusable, named procedure that agents can invoke.

---

## Format

One markdown file per skill. Frontmatter:

```markdown
---
name: <skill-name-kebab-case>
description: <one-line, agent-readable summary used for retrieval>
inputs:
  - <input-name>: <type or description>
outputs:
  - <output-name>: <type or description>
tested: <YYYY-MM-DD or never>
confidence: [H] | [M] | [L]
---

# <Human-readable title>

## Procedure

Step-by-step instructions.

## Examples

Worked examples with inputs/outputs.

## Failure modes

Known ways this skill can fail, and what to do.
```

## Manifest

A top-level `manifest.json` (created at first skill registration) lists all skills with their descriptions for fast lookup.

## Lifecycle

- **Add:** EAC or any agent writes a skill file; Memory-Keeper updates the manifest
- **Use:** Any agent retrieves by name or semantic search
- **Update:** Edit in place; bump `tested` date when re-verified
- **Retire:** Move to `retired/` subdirectory; never delete

## What belongs here

- Reusable procedures with stable inputs/outputs
- Worked examples for common project operations
- Recovery procedures for known failure modes

## What does NOT belong here

- One-off scripts (those go in `../../scripts/`)
- Documentation about the project itself (that's in `../self-knowledge.md` or layer specs)
- Lessons-learned (those have their own directory)
