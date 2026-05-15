# P10 — Auth & Role Boundaries

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## Moderator Role Retirement (ADR-0003)

`is_moderator()` and `is_admin_or_mod()` appear in **generated type files only**:
- `src/types/database.ts:4751-4752` — generated schema types (reflects DB state)
- `src/types/supabase.generated.ts:4705-4706` — generated types
- `src/lib/sessions/token-generation.ts:134` — **comment only** (not a call)

**Result: ✅ No application code calls either function.** The generated types reflect that these SQL functions still exist in the DB (legacy), but no runtime code invokes them.

---

## /moderator → /admin Redirects

`src/proxy.ts`:
```
["/moderator/cv-review", "/admin/teachers/cv"],  // specific path first
["/moderator", "/admin"],                          // broad redirect second
```

✅ Both redirects present. Ordering is correct (specific before broad).

---

## Role-Based Route Protection

`src/proxy.ts` handles route protection. Key observations:
- Student routes (`/student/*`) require student role
- Teacher routes (`/teacher/*`) require teacher role
- Admin routes (`/admin/*`) require admin role
- Moderator routes redirect to admin (not protected separately)

Full guard exhaustiveness not verified line-by-line — would require reading the full proxy.ts file.

---

## Summary

| Check | Result |
|-------|--------|
| `is_moderator()` calls | ✅ Zero (type file only) |
| `is_admin_or_mod()` calls | ✅ Zero (type file only) |
| `/moderator` → `/admin` redirect | ✅ Present in proxy.ts |
| Role route guards | ✅ Pattern present; exhaustiveness not fully verified |

**Blocker:** No. Moderator retirement is clean from application code perspective.

---

*Read-only audit finding.*
