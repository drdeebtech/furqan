-- 20260428053535_fix_redact_pii_volatility.sql
-- Re-declare public.redact_pii as STABLE instead of IMMUTABLE.
--
-- v15_002 marked the function IMMUTABLE, but its body uses jsonb_set which
-- Postgres classifies as STABLE (it can in theory depend on session-level
-- search_path / GUCs). `supabase db lint --fail-on warning` rightly flags
-- the mismatch:
--   "routine is marked as IMMUTABLE, but expression is STABLE"
--
-- STABLE is the correct, honest marker — same input, same output within a
-- single transaction, but not across sessions. The function isn't used in an
-- index or generated column, so the IMMUTABLE label gave us nothing anyway.

create or replace function public.redact_pii(payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  redacted jsonb := payload;
  pii_keys text[] := array[
    'email', 'phone', 'parent_email', 'parent_phone', 'whatsapp',
    'date_of_birth', 'avatar_url'
  ];
  k text;
begin
  if payload is null then
    return null;
  end if;
  foreach k in array pii_keys loop
    if redacted ? k then
      redacted := jsonb_set(redacted, array[k], to_jsonb('***REDACTED***'::text));
    end if;
  end loop;
  return redacted;
end;
$$;
