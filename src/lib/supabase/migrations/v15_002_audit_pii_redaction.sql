-- v15_002: redact PII from audit_log on insert.
--
-- The audit_log.old_data and new_data JSONB columns were storing full row
-- snapshots including emails, phone numbers, parent contact info — values
-- that GDPR / data-protection regulators consider PII. This migration adds
-- a BEFORE INSERT trigger that masks known sensitive keys to '***REDACTED***'
-- before the row hits disk.
--
-- The change is one-way (existing audit_log rows are NOT backfilled).
-- Backfill is intentionally out of scope: rewriting historical audit data
-- defeats audit-trail integrity. Old rows can be redacted via a one-off
-- maintenance script if compliance later demands it.

create or replace function public.redact_pii(payload jsonb)
returns jsonb
language plpgsql
immutable
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

create or replace function public.audit_log_redact_pii_trigger()
returns trigger
language plpgsql
as $$
begin
  new.old_data := public.redact_pii(new.old_data);
  new.new_data := public.redact_pii(new.new_data);
  return new;
end;
$$;

drop trigger if exists t_audit_log_redact on public.audit_log;
create trigger t_audit_log_redact
  before insert on public.audit_log
  for each row
  execute function public.audit_log_redact_pii_trigger();

insert into schema_migrations (version, description)
  values ('v15_002', 'V15.2: BEFORE INSERT trigger to redact PII (email/phone/dob/etc) from audit_log JSONB payloads')
  on conflict do nothing;
