# TestSprite Web Portal — Upload Bundle

Clean, secret-free inputs for the TestSprite Web Portal (https://app.testsprite.com).
Nothing here contains credentials — safe to upload and to commit.

## Files
| File | Upload as | Purpose |
|------|-----------|---------|
| `PRD.md` | **PRD / product spec** (Project Setup step) | Builds the feature map — what the product *should* do. Strongly recommended; improves plan coverage. |
| `openapi.yaml` | **API documentation** (Configure step, API project) | Precise endpoint shapes, auth requirements, and intentional-state annotations for the REST perimeter. |

## How to use

### API (backend) project
1. **Create Tests → API**, name it `furqan-api`.
2. Upload `PRD.md` as the product spec.
3. Base URL: `https://www.furqan.today`.
4. Upload `openapi.yaml` as the API documentation.
5. **Credentials / Auto-Auth (Pro):** add one test account per role (student, teacher, admin)
   so authenticated endpoints are reachable. There is **no anonymous bypass login in
   production by design**, so real credentials are required for authenticated coverage.
6. Review the plan. The endpoints marked "INTENTIONAL STUB / HARD-DISABLED" in
   `openapi.yaml` return **501** on purpose — keep their expected status as 501, not 200.

### UI (frontend) project — higher coverage
Most business logic is in Next.js server actions, not REST, so the UI project exercises
more product behavior:
1. **Create Tests → UI**, name it `furqan-ui`.
2. Upload `PRD.md`.
3. Live URL: `https://www.furqan.today`.
4. Add the same per-role test credentials.
5. Let Feature Exploration walk the live app; review the plan; generate & run.

## Gotchas baked into the docs
- Apex `furqan.today` 307-redirects to `www` — use `https://www.furqan.today`.
- Stripe checkout/webhook and `/api/bookings` are intentionally **501** (fail-closed).
- Webhooks (Daily/Bunny) reject bad signatures with **401** in production.
- Cron endpoints are **GET-only** with dual secrets — not portal-testable without the secrets; skip or expect 401/405.
- The local-only `test-login` route is **not** in the spec (it doesn't exist in production).

## Refresh
`openapi.yaml` is hand-maintained from `src/app/api/**/route.ts`. If routes change,
re-enumerate methods and update the spec before re-uploading.
