# Evals

Deterministic golden-case tests for FURQAN's critical business logic.

Evals differ from unit tests in that they encode **spec-level invariants** — the
cases that, if broken, indicate a fundamental correctness failure rather than a
code-level bug. They are run as part of the standard vitest suite.

## Running

```bash
npm run test:unit -- evals/
```

## Files

| File | What it tests |
|------|--------------|
| `sm2-review-outcome.eval.ts` | SM-2 spaced-repetition algorithm — golden interval/EF cases |

## Adding new evals

Name new files `<domain>.eval.ts` and place them here. Follow the Arrange-Act-Assert pattern and use concrete numeric expectations rather than range checks where the spec is unambiguous.
