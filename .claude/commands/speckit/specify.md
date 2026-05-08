---
description: Create or update a feature specification at specs/<feature>/spec.md from a natural-language description. Spec-kit step 1.
---

Invoke the `speckit-specify` skill with the user's feature description as `args`. The skill creates a feature branch, scaffolds `specs/<NNN-feature-slug>/spec.md` from `.specify/templates/spec-template.md`, and populates it from the description. After it returns, summarise the new spec path and the user-stories / success-criteria the skill chose.

Reference: `CLAUDE.md` "Spec-Kit Workflow"; constitution at `.specify/memory/constitution.md`.
