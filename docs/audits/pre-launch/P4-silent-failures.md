# P4 — Silent Failures & Error Handling

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## Empty / Swallowed Catch Blocks

**Result: ✅ Zero empty catch blocks found in src/**

No `catch (_e) {}` or `catch(e) {}` patterns with empty bodies detected.

---

## loudAction Coverage

### Files WITH loudAction ✅

| File | Actions wrapped |
|------|----------------|
| `src/lib/actions/homework.ts` | createHomework, markStudentReady, gradeHomework, editHomework, deleteHomework (5 of 6) |
| `src/lib/actions/account.ts` | updatePassword, updateEmail |
| `src/lib/actions/group-session.ts` | addStudentToSession |
| `src/lib/actions/session-lesson-plan.ts` | (at least 1) |
| `src/lib/actions/evaluations.ts` | (confirmed) |
| `src/lib/actions/retention-batch.ts` | wrapped |
| `src/lib/actions/retention-scoring.ts` | wrapped |

### Files WITHOUT loudAction ⚠️

These action files have server actions that write to the DB but are not wrapped in `loudAction`:

| File | Risk |
|------|------|
| `src/lib/actions/community.ts` | Community posts/replies — failures invisible |
| `src/lib/actions/courses.ts` | Course management mutations |
| `src/lib/actions/course-lessons.ts` | Lesson CRUD |
| `src/lib/actions/course-playback.ts` | Playback state writes |
| `src/lib/actions/course-reviews.ts` | Review submissions |
| `src/lib/actions/modules.ts` | Module mutations |
| `src/lib/actions/quizzes.ts` | Quiz mutations |
| `src/lib/actions/resources.ts` | Resource uploads/edits |
| `src/lib/actions/notifications.ts` | Notification state changes |
| `src/lib/actions/study-log.ts` | Study log writes |
| `src/lib/actions/help.ts` | Help ticket mutations |
| `src/lib/actions/class-offerings.ts` | Class offering mutations |
| `src/lib/actions/cache.ts` | Cache invalidation (less critical) |

Open issues cross-referencing this gap: #239, #232, #227.

---

## API Route Error Capture

All checked `.error` patterns in `src/app/api/` are captured correctly:
- `n8n/auto-restart/route.ts` — error included in batch audit log reason string ✅
- `webhooks/bunny/route.ts` — `args.error` from webhook payload stored to DB ✅
- `webhooks/n8n/route.ts` — `data.error_message` from n8n payload stored to DB ✅

No uncaptured DB errors found in API routes.

---

## n8n Client Error Handling

`src/lib/n8n/client.ts`:
- Throws on missing `N8N_API_KEY` / `N8N_API_URL` ✅
- `logError()` called on Telegram alert failures ✅
- Non-200 responses throw with status + body ✅

---

## Summary

| Check | Result |
|-------|--------|
| Empty catch blocks | ✅ None |
| homework.ts loudAction | ✅ 5 of 6 actions wrapped |
| API route DB error capture | ✅ Clean |
| n8n client error handling | ✅ Proper |
| 13 action files without loudAction | ⚠️ Courses, community, quizzes, resources domain actions unwrapped |

**Blocker:** No. Build passes, critical paths (homework, booking, account) are covered. Unwrapped action files are medium-priority hardening work (issues #239, #232, #227).

---

*Read-only audit finding.*
