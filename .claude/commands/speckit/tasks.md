---
description: Emit a dependency-ordered tasks.md from the feature's plan and design artefacts. Spec-kit step 4.
---

Invoke the `speckit-tasks` skill. It reads `specs/<feature>/{spec,plan,data-model}.md` and emits `tasks.md` ordered by dependency. Tasks should be small enough that each one maps to a single PR or a single TDD red-green-refactor cycle.
