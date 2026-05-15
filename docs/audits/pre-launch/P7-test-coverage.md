# P7 — Test Coverage

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## Unit Tests (Vitest)

**Result:** 19 test files passed (1 skipped), 225 tests passed (24 skipped). Duration 1.08s.

### Coverage tooling

`@vitest/coverage-v8` is **not installed** — coverage % cannot be generated. CI has no coverage gate.

### Test files present

| File | What it covers |
|------|---------------|
| `src/app/api/webhooks/daily/route.test.ts` | Daily.co webhook handler |
| `src/app/api/webhooks/daily/idempotency.test.ts` | Daily webhook idempotency |
| `src/lib/actions/loud.test.ts` | loudAction wrapper |
| `src/lib/actions/retention.test.ts` | Retention scoring actions |
| `src/lib/auth/require-admin.test.ts` | Admin auth guard |
| `src/lib/automation/emit.test.ts` | Event emission |
| `src/lib/cn.test.ts` | className utility |
| `src/lib/daily/webhook-handler.test.ts` | Daily webhook handler logic |
| `src/lib/daily/webhook-verify.test.ts` | HMAC verification |
| `src/lib/domains/booking/orchestrate.test.ts` | Booking orchestration |
| `src/lib/domains/booking/validation.test.ts` | Booking validation |
| `src/lib/i18n/format-date.test.ts` | Date formatting |
| `src/lib/n8n/audit.test.ts` | n8n audit calls |
| `src/lib/notifications/dispatcher-quiet-hours.test.ts` | Quiet hours logic |
| `src/lib/security/secrets.test.ts` | Timing-safe compare |
| `src/lib/sentry/before-send.test.ts` | Sentry filter |
| `src/lib/settings.test.ts` | Settings key validation |
| `src/lib/supabase/no-silent-fails.test.ts` | DB error propagation |
| `src/lib/supabase/rls.test.ts` | RLS policy smoke tests |

### Domains with zero unit test coverage

| Domain | Files |
|--------|-------|
| Community | `src/lib/actions/community.ts` |
| Courses | `src/lib/actions/courses.ts`, `course-lessons.ts`, `course-playback.ts`, `course-reviews.ts`, `modules.ts` |
| Quizzes | `src/lib/actions/quizzes.ts` |
| Resources | `src/lib/actions/resources.ts` |
| Packages | `src/lib/actions/packages.ts` |
| WhatsApp | `src/lib/whatsapp.ts` |
| Cron routes | All 10 `src/app/api/cron/*/route.ts` |
| Notifications | `src/lib/notifications/dispatcher.ts`, `parent.ts` |

---

## E2E Tests (Playwright)

10 spec files:

| File | Coverage |
|------|---------|
| `auth-smoke.spec.ts` | Login / auth flow |
| `public-smoke.spec.ts` | Public pages load |
| `admin-cv-edit.spec.ts` | CV review flow |
| `admin-tabs-diagnostic.spec.ts` | Admin tabs render |
| `admin-tabs-visual-audit.spec.ts` | Admin UI visual check |
| `daily-webhook-reconciliation.spec.ts` | Session webhook reconciliation |
| `daily-webhook-idempotency.spec.ts` | Session webhook idempotency |
| `notification-badge.spec.ts` | Notification badge |
| `session-flow.spec.ts` | Session lifecycle |
| `retention-smoke.spec.ts` | Retention scoring smoke |

**Gaps:** No E2E for booking creation, student dashboard, teacher dashboard, package purchase, homework submission.

---

## Summary

| Check | Result |
|-------|--------|
| Unit tests pass | ✅ 225/249 pass |
| Coverage tooling | ⚠️ `@vitest/coverage-v8` not installed — no % enforced |
| Critical paths tested | ✅ booking, webhook, auth, loudAction, RLS, retention |
| Uncovered domains | ⚠️ courses, community, quizzes, packages, WhatsApp, cron routes |
| E2E files | 10 — covers auth, admin, session lifecycle |
| E2E gaps | ⚠️ No booking, student dashboard, or payment E2E |

**Blocker:** No. Core infrastructure is tested. Coverage tooling gap means the 80% threshold isn't enforced in CI — should install `@vitest/coverage-v8` and add a coverage step.

---

*Read-only audit finding.*
