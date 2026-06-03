---
description: Create a refined requirement from a prompt (local, no external services)
allowed-tools: Bash, Read, Write, Glob, Grep, Skill(deebgrind)
argument-hint: [prompt text]
---

Turn a vague idea into a structured requirement with acceptance criteria. No CLI, no cloud
— everything is stored in `~/.deebgrind/<project>/requirements/`.

**Invoke the deebgrind skill** for workflow context if needed.

---

## Step 1 — Get the prompt

**If $ARGUMENTS is provided and non-empty:** use it as the base prompt.

**If $ARGUMENTS is empty:** auto-detect from conversation in this order:

1. Search for a recent `ExitPlanMode` tool result in the conversation → use the plan content.
2. Search for contiguous markdown blocks (headers + lists) that describe a feature/task →
   extract and use as the base prompt.
3. If nothing found: print
   `"❌ No prompt found. Provide one: /dg-specify 'your idea here'"` and stop.

---

## Step 2 — Refine the prompt into a requirement

Using the base prompt plus context from `CLAUDE.md` (conventions, stack, scale target),
synthesise a complete requirement document in this format:

```markdown
# REQ-N: <Short Descriptive Name>

**Status:** IDEA
**Created:** <ISO 8601 timestamp>
**Slug:** <kebab-case-name>

## Problem Statement
<1–3 paragraphs. What needs solving, why it matters, who is affected.>

## Acceptance Criteria
- Given <context>, When <action>, Then <outcome>.
- Given <context>, When <action>, Then <outcome>.
[3–8 criteria, each independently verifiable]

## Implementation Notes
<Tech approach, relevant files/patterns, edge cases, constraints.
Reference furqan patterns from CLAUDE.md (e.g., emitEvent, loudAction, RLS at scale).>

## Out of Scope
<Explicit exclusions to prevent scope creep.>
```

---

## Step 3 — Allocate REQ-N

1. Derive the deebgrind directory:
   ```
   DEEBGRIND_DIR="${HOME}/.deebgrind/$(basename "${CLAUDE_PROJECT_DIR:-.}")"
   ```

2. Read `$DEEBGRIND_DIR/requirements/index.json`.
   - If the file doesn't exist or is `[]`, next ID = `REQ-1`.
   - Otherwise next ID = `REQ-(max_existing_N + 1)`.

3. Write the requirement document to `$DEEBGRIND_DIR/requirements/REQ-N.md`.

4. Append an entry to `index.json`:
   ```json
   {"id": "REQ-N", "name": "<short name>", "status": "IDEA", "slug": "<slug>", "created_at": "<ISO 8601>"}
   ```
   (Read the file first, add the entry, write the full updated array back.)

---

## Step 4 — Output

Print the full requirement document, then:

```
✅ REQ-N created  →  ~/.deebgrind/<project>/requirements/REQ-N.md

Next steps:
  /dg-build REQ-N        →  implement it
  /dg-list               →  view the backlog
```

---

## Error handling

- **index.json parse error**: Print error, do not write. Ask user to inspect the file.
- **File write error**: Print the requirement to screen and ask user to save it manually.
- **Prompt too vague** (less than 15 chars): Ask for more detail before refining.
