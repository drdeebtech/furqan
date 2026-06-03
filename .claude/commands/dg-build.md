---
description: Build a requirement — branch, task breakdown, implement, verify acceptance criteria
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill(deebgrind), TaskCreate, TaskUpdate, TaskList
argument-hint: [REQ-N] [additional instructions]
---

Fetch a local requirement and drive it from zero to verified completion. No external services.
Works entirely against `~/.deebgrind/<project>/`.

**Invoke the deebgrind skill** for workflow context.

---

## Step 1 — Derive paths

```bash
DEEBGRIND_DIR="${HOME}/.deebgrind/$(basename "${CLAUDE_PROJECT_DIR:-.}")"
```

---

## Step 2 — Resolve requirement ID

- If $ARGUMENTS starts with `REQ-`, `req-`, or a plain number → use that as the ID.
- Otherwise → detect from current git branch name (pattern `REQ-\d+`).
- If still unresolved → list available requirements and ask: "Which requirement? (REQ-N)"

---

## Step 3 — Read requirement

Read `$DEEBGRIND_DIR/requirements/REQ-N.md`. If it doesn't exist:
- Print `"❌ REQ-N not found. Run /dg-list to see available requirements."`
- Stop.

Parse any additional instructions from $ARGUMENTS (everything after the ID).

---

## Step 4 — Activate build sentinel

```bash
mkdir -p "$DEEBGRIND_DIR/temp"
echo "REQ-N" > "$DEEBGRIND_DIR/temp/build-active.local"
```

This activates the `dg-*` hooks. Must exist before any `TaskCreate` call.

---

## Step 5 — Create feature branch (furqan Branch Hygiene)

Check current branch:
```bash
git rev-parse --abbrev-ref HEAD
```

**Skip branch creation if** the current branch already contains `REQ-N`.

**Otherwise:**
```bash
git checkout main && git pull --ff-only && git checkout -b feature/REQ-N-<slug>
```
Where `<slug>` = the requirement's `slug` field from `index.json`.

---

## Step 6 — Extract acceptance criteria

1. Parse the `## Acceptance Criteria` section from the requirement.
2. Write checklist to `$DEEBGRIND_DIR/temp/REQ-N-acceptance-criteria.md`:

```
## Acceptance Criteria
- [] Given a teacher visits the export page, When they select a date range, Then a CSV download starts.
- [] Given the export, When opened in Excel, Then columns match the spec.
```

Rules: each criterion prefixed `- []`, no blank lines between items, no subheadings.
Count: capture N_CRITERIA.

3. If no `## Acceptance Criteria` section exists: skip steps 6 and 7 (no verification loop).

---

## Step 7 — Write verification state file

Write `$DEEBGRIND_DIR/temp/REQ-N-build-verification.local.md`:

```markdown
---
active: true
iteration: 0
max_iterations: 15
requirement_id: REQ-N
criteria_file: /home/<user>/.deebgrind/<project>/temp/REQ-N-acceptance-criteria.md
started_at: <ISO 8601>
---

Continue verifying acceptance criteria for REQ-N.

Read the criteria at `$DEEBGRIND_DIR/temp/REQ-N-acceptance-criteria.md`.

For each unchecked criterion (line starting with `- []`):
1. Examine the implementation to verify the criterion is satisfied
2. Run relevant tests or check behaviour if applicable
3. Change `- []` to `- [x]`
4. Add a `Proof:` line immediately below explaining HOW it's satisfied

Keep going until ALL criteria show `[x]` with proof.
```

Use absolute paths for `criteria_file` (expand `~`).

---

## Step 8 — Update requirement status to IN_PROGRESS

In `$DEEBGRIND_DIR/requirements/index.json`, update this requirement's `status` to
`"IN_PROGRESS"` and add `"branch": "feature/REQ-N-<slug>"`. Write the updated array back.

---

## Step 9 — Break into tasks and create them (ONE AT A TIME)

Analyse the requirement (description, acceptance criteria, implementation notes) and create
3–7 tasks.

Task naming: `TASK N: type: description`  (type ∈ feat/fix/docs/style/refactor/perf/test/chore)
Optionally: `TASK N: type(scope): description (blocked by 1,2)`

**Create tasks one at a time using TaskCreate** — do not batch. The naming hook fires on
each call; parallel calls cause hook errors.

Example:
```
TASK 1: feat: create CSV export server action
TASK 2: feat(ui): add date-range picker to teacher dashboard
TASK 3: test: add unit tests for CSV export
TASK 4: docs: update teacher dashboard changelog
```

After all tasks created, call `TaskList` to show the work queue.

If additional instructions were in $ARGUMENTS, acknowledge them and apply throughout.

---

## Step 10 — Implement sequentially. Do NOT pause between tasks.

For each task:
1. `TaskUpdate` → `in_progress`
2. Implement the work (follow furqan coding patterns from CLAUDE.md)
3. Commit: `git add -p && git commit -m "type: description"`
4. `TaskUpdate` → update subject to `TASK N (HASH): type: description`
   where `HASH = $(git rev-parse --short HEAD)`
5. `TaskUpdate` → `completed`

Only pause for genuine blockers (missing credentials, conflicting spec, truly ambiguous AC).
Do NOT ask "should I continue?" between tasks — just continue.

---

## Step 11 — Bulk sync check (before verification)

After ALL tasks are `completed`:

Verify all tasks were completed. If any look missed, mark them completed with the short hash.

---

## Step 12 — Acceptance criteria verification loop

The Stop hook (`dg-verify-acceptance-criteria.sh`) will prevent session exit until every
`- []` criterion becomes `- [x]` with `Proof:`.

After all tasks complete, begin verification:

1. Read `$DEEBGRIND_DIR/temp/REQ-N-acceptance-criteria.md`
2. For each `- []` line:
   - Examine the implementation, run tests, or check behaviour
   - Change `- []` to `- [x]`
   - Add `Proof: <explanation>` on the next line
3. Write the updated file back
4. Continue until no `- []` lines remain

---

## Step 13 — Wrap up

1. In `index.json` set this requirement's `status` to `"REVIEW"`. Write back.
2. Delete temp files:
   ```bash
   rm -f "$DEEBGRIND_DIR/temp/REQ-N-"*.md \
          "$DEEBGRIND_DIR/temp/REQ-N-"*.local \
          "$DEEBGRIND_DIR/temp/build-active.local" \
          "$DEEBGRIND_DIR/temp/REQ-N-verify-prev-unchecked.local"
   ```
3. Print summary:

```
✅ REQ-N complete
📋 Name: <requirement name>
🔄 Status: REVIEW
🌿 Branch: feature/REQ-N-<slug>
✅ All N acceptance criteria verified

Next: open a PR with  gh pr create
```

---

## Error recovery

- **Requirement not found**: list requirements and ask which to build
- **Branch creation fails**: warn, continue on current branch
- **Task hook denies**: fix the naming and retry (never skip)
- **Verification stuck**: if the Stop hook has re-injected 3+ times with no progress,
  diagnose the failing criterion explicitly (run the test, read the code path)
