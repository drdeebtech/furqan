---
description: Show the deebgrind requirement backlog grouped by status
allowed-tools: Bash, Read
---

Show the local deebgrind requirement backlog.

**Instructions:**

1. Derive the deebgrind directory:
   ```bash
   echo "${HOME}/.deebgrind/$(basename "${CLAUDE_PROJECT_DIR:-.}")/requirements/index.json"
   ```

2. Read `index.json`. If it doesn't exist or is empty (`[]`), print: "No requirements yet. Run `/dg-specify` to create one."

3. Group requirements by status and print:

```
IDEA
  REQ-1  add teacher attendance CSV export
  REQ-3  redesign student dashboard

IN_PROGRESS
  REQ-2  add session reminder notifications  (branch: feature/REQ-2-session-reminders)

REVIEW
  REQ-4  fix lesson completion bug

COMPLETED
  REQ-5  add parent portal login
```

Include the git branch name next to IN_PROGRESS requirements if present in the entry.

4. Print a summary line: `Total: N requirements (X completed, Y in progress, Z remaining)`

**Status order for display:** IN_PROGRESS → IDEA → PLANNED → REVIEW → COMPLETED → CANCELLED
