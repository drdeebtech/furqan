---
description: Non-destructive consistency check across spec.md, plan.md, and tasks.md after task generation. Spec-kit step 5.
---

Invoke the `speckit-analyze` skill. It cross-checks the three artefacts for drift (e.g., a task that references a contract not in `contracts/`, a success criterion the plan doesn't address, a constitution principle the plan ignores). Report findings without auto-fixing them; the operator decides what to amend.
