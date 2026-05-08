---
description: Execute tasks.md one at a time against the codebase. Spec-kit step 6.
---

Invoke the `speckit-implement` skill. It walks `specs/<feature>/tasks.md` top-to-bottom, opening a sub-conversation per task. Each task implementation should follow FURQAN's red-green-refactor TDD rule and the constitution's Pre-commit checklist (silent-fail tripwire, branch echo, gitnexus_detect_changes).
