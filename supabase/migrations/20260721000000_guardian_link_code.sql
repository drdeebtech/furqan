-- 20260721000000_guardian_link_code.sql
--
-- Audit AUTHZ-VULN-01: /api/guardian/add-child linked a guardian to ANY
-- account with role='student' knowing only the email — no proof of parental
-- relationship. This adds a per-student "guardian link code" that the student
-- sees in their settings and shares out-of-band; the guardian must supply it
-- (in addition to the email) to link. A stranger who only knows an email can
-- no longer attach to a child's records.
--
-- Lens check:
--   📖 Quran/teaching: protects minors' academic records (teacher notes,
--      monthly reports, certificates) from unconsented access.
--   🛠 engineer: pure additive column read by app code; no RLS/table drop.
--   🎓 platform: code is human-shareable (10 hex chars), rotatable later.
--
-- Expand/contract SAFE (AGENTS.md §4): add a NULLABLE column, backfill per-row
-- (distinct codes — a volatile DEFAULT on ADD COLUMN would give every existing
-- row the SAME value and rewrite the table under ACCESS EXCLUSIVE), then set
-- the DEFAULT for future inserts. Old running code never reads/writes this
-- column, so the concurrent migration+build deploy cannot break it. New code
-- that reads it treats a NULL/absent code as "not linkable yet" (fail-closed).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS guardian_link_code text;

-- Backfill every existing profile with a distinct 10-hex-char code (~40 bits;
-- unguessable under the endpoint's 20-requests/hour guardian rate limit).
-- gen_random_uuid() is volatile, so each row gets its own value.
UPDATE public.profiles
   SET guardian_link_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
 WHERE guardian_link_code IS NULL;

-- New rows auto-generate their own code. SET DEFAULT does not rewrite the table.
ALTER TABLE public.profiles
  ALTER COLUMN guardian_link_code
  SET DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

COMMENT ON COLUMN public.profiles.guardian_link_code IS
  'Student-visible code shared out-of-band with a guardian; required (with the student email) to create a guardian_children link. Closes AUTHZ-VULN-01.';
