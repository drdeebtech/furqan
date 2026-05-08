---
description: Generate plan.md, research.md, data-model.md, and contracts/ from the clarified spec. Checks the plan against `.specify/memory/constitution.md`. Spec-kit step 3.
---

Invoke the `speckit-plan` skill. It expects a populated `specs/<feature>/spec.md` and produces the design artefacts. The skill must validate the resulting plan against the five constitution principles (Domain Ownership, Loud Failures, Atomic Critical Paths, Auth at the Boundary, Tracer-Bullet Adoption) and surface any unjustified deviations before tasks are generated.
