# Runbook — clean up K6 test users from production

**Status:** 🔧 Pending operator confirmation
**Owner:** Operator (destructive, needs sequence + per-step confirmation)
**Estimated time:** 1–2 hours including dry-runs

## Problem

500 K6 Test Student rows exist in production `auth.users` (from the load-test campaign documented in `Project Memory/furqan/k6 Smoke Test.md`). They appear in:

- `auth.users` (the canonical row)
- `profiles` (one-per-user, via `handle_new_user()` trigger)
- Possibly: `notifications`, `student_packages`, `bookings`, `messages`, `conversations`, `homework_assignments`, `student_progress`, `recitation_errors`, `study_log`, `audit_log`

These are visible to real users browsing `/student/teachers`, `/community`, etc. — the platform looks unprofessional with 500 obviously-test accounts.

## Why this needs a runbook, not a one-shot delete

Cascade-deleting 500 `auth.users` rows triggers FK cascades into 10+ tables. Some tables (`audit_log`) are retention-critical. Order + dry-run matter.

## Operator steps

### Step 1: Identify the K6 cohort

```sql
-- Open Supabase Dashboard → SQL Editor (as alforqan.egy@gmail.com).
-- Dry-run: count + list the K6 cohort. Confirm the WHERE clause matches your expectations.
select
  count(*) as total,
  min(created_at) as earliest,
  max(created_at) as latest
from auth.users
where email like 'k6%@%'   -- adjust if k6 used a different pattern
   or raw_user_meta_data->>'full_name' like 'K6 Test Student%';
```

**STOP if the count is materially different from 500.** That means the WHERE clause is wrong or rows have already been partially deleted. Diagnose before proceeding.

### Step 2: Snapshot affected rows (in case you need to roll back)

```sql
-- One-time backup table.
create table audit_archive.k6_cleanup_2026_05_12 as
select
  u.id,
  u.email,
  u.created_at,
  p.full_name,
  p.role
from auth.users u
join public.profiles p on p.id = u.id
where u.email like 'k6%@%'
   or u.raw_user_meta_data->>'full_name' like 'K6 Test Student%';

select count(*) from audit_archive.k6_cleanup_2026_05_12;
```

Should match Step 1's count.

### Step 3: Dry-run the cascade impact

```sql
-- For each table that references profiles.id or auth.users.id, count
-- rows that will be cascade-deleted. Anything >0 is data that vanishes
-- on Step 4.
with cohort as (
  select id from auth.users
  where email like 'k6%@%'
     or raw_user_meta_data->>'full_name' like 'K6 Test Student%'
)
select 'bookings'              as table, count(*) from bookings              where student_id in (select id from cohort) union all
select 'student_packages'      as table, count(*) from student_packages      where student_id in (select id from cohort) union all
select 'homework_assignments'  as table, count(*) from homework_assignments  where student_id in (select id from cohort) union all
select 'student_progress'      as table, count(*) from student_progress      where student_id in (select id from cohort) union all
select 'recitation_errors'     as table, count(*) from recitation_errors     where student_id in (select id from cohort) union all
select 'study_log'             as table, count(*) from study_log             where user_id    in (select id from cohort) union all
select 'notifications'         as table, count(*) from notifications         where user_id    in (select id from cohort) union all
select 'conversations'         as table, count(*) from conversations         where student_id in (select id from cohort) or teacher_id in (select id from cohort) union all
select 'messages'              as table, count(*) from messages              where sender_id  in (select id from cohort) union all
select 'forum_threads'         as table, count(*) from forum_threads         where author_id  in (select id from cohort) union all
select 'forum_replies'         as table, count(*) from forum_replies         where author_id  in (select id from cohort);
```

**Decision point**: if `bookings` count > 0 with a non-cancelled real teacher, those bookings are NOT pure test data and need a different cleanup path. Stop and review.

### Step 4: Manual cleanup of forum content (preserve activation seeds)

Per the 2026-05-05 audit decision, 6 `[demo]` forum threads stay. K6-authored threads (and replies under them) go.

```sql
-- Targeted forum cleanup BEFORE the user cascade. The cascade would
-- delete the threads anyway, but doing it explicitly here lets you
-- see what's being removed.
delete from forum_replies
where author_id in (
  select id from auth.users
  where email like 'k6%@%'
     or raw_user_meta_data->>'full_name' like 'K6 Test Student%'
);

delete from forum_threads
where author_id in (
  select id from auth.users
  where email like 'k6%@%'
     or raw_user_meta_data->>'full_name' like 'K6 Test Student%'
);
```

### Step 5: Delete the users

```sql
-- This is the one-and-only destructive step. The auth.users delete
-- cascades to public.profiles via the FK constraint, which then
-- cascades to every other table that references profiles.id.
delete from auth.users
where email like 'k6%@%'
   or raw_user_meta_data->>'full_name' like 'K6 Test Student%';

-- Verify
select count(*) from auth.users
where email like 'k6%@%'
   or raw_user_meta_data->>'full_name' like 'K6 Test Student%';
-- Expected: 0
```

### Step 6: Verify in the UI

- `/admin/users` should no longer paginate to 500+ test rows.
- `/community` should still show the 6 `[demo]` threads but no K6-authored content.
- `/student/teachers` (if K6 cohort included teacher accounts — unlikely but check) should be unchanged.
- `audit_log` should NOT be empty for FURQAN's real users — confirm by counting recent entries.

## Roll-back plan (only if Step 5 went catastrophically wrong)

The `audit_archive.k6_cleanup_2026_05_12` snapshot from Step 2 only retains email + name. **Restoring K6 users to `auth.users` is non-trivial** — Supabase auth.users rows have hashed passwords + auth.identities entries that the snapshot doesn't capture. Treat Step 5 as irreversible. If you delete a non-K6 user by mistake, recovery means re-registration from the user's side, not SQL.

This is why Steps 1–4 are deliberately separate from Step 5.

## Related

- CLAUDE.md → "Remaining Work" (test data cleanup, deferred)
- `Project Memory/furqan/Findings Backlog.md` → F8 (partial — community cleanup shipped, user cleanup deferred to this runbook)
- `Project Memory/furqan/k6 Smoke Test.md` — original load-test that produced these rows
- Bad-list item #6 (P3 hygiene)
