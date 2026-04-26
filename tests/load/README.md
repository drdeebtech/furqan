# Load tests

Synthetic traffic for the production app, kept small enough that we can re-run safely without burning Vercel quotas.

## Smoke test

```bash
k6 run tests/load/smoke.js
```

5 virtual users walk through 5 public pages over 60 seconds (~1.5 RPS sustained). Identifies itself with `User-Agent: furqan-k6-smoke/1.0` so synthetic traffic is filterable in logs.

Override the target:

```bash
k6 run -e BASE_URL=https://furqan-preview.vercel.app tests/load/smoke.js
```

After the run, check Sentry for any new issues:

```bash
sentry issue list furqan-academy/javascript-nextjs
```
