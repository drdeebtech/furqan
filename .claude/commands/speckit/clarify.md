---
description: Identify underspecified areas in the current feature spec by asking up to 5 highly targeted clarification questions and encoding answers back into spec.md. Spec-kit step 2.
---

Invoke the `speckit-clarify` skill. It reads the active feature's `specs/<feature>/spec.md`, picks up to five gaps, asks the user, and writes the answers back. Run this before `/speckit.plan` so the plan is built on a clarified spec.
