-- 20260630000000_certificate_public_share.sql
-- Spec 031 — shareable PDF certificate + Bunny CDN + /certificates/[slug]
--
-- Adds three columns to public.certificates:
--   public_slug        — unguessable UUID capability URL token (NOT NULL, DEFAULT gen_random_uuid())
--   pdf_url            — CDN URL of the generated PDF (written by service-role after generation)
--   pdf_generated_at   — timestamp of last successful PDF generation
--
-- Also recreates the BEFORE UPDATE OF identity-guard trigger to protect public_slug
-- against client-side rotation. pdf_url / pdf_generated_at are intentionally NOT
-- in the guard so the service-role PDF route can write them.
--
-- No new RLS policy: public reads go through createAdminClient() in view.ts,
-- filtered by exact public_slug — the unguessable slug IS the authorization.
-- Existing "certificates_select_self_or_guardian_or_admin" policy stays.

alter table public.certificates
  add column if not exists public_slug uuid not null default gen_random_uuid(),
  add column if not exists pdf_url text,
  add column if not exists pdf_generated_at timestamptz;

create unique index if not exists uix_certificates_public_slug
  on public.certificates(public_slug);

-- Recreate the identity-guard function to also protect public_slug.
-- Guard list: student_id, certificate_type, milestone_key,
--             cited_range_start, cited_range_end, public_slug  ← new
-- NOT guarded: pdf_url, pdf_generated_at (service-role writes after PDF generation)
create or replace function private.guard_certificates_identity_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if v_jwt_role is null or v_jwt_role = 'service_role' or private.is_admin() then
    return new;
  end if;
  if new.student_id is distinct from old.student_id
     or new.certificate_type is distinct from old.certificate_type
     or new.milestone_key is distinct from old.milestone_key
     or new.cited_range_start is distinct from old.cited_range_start
     or new.cited_range_end is distinct from old.cited_range_end
     or new.public_slug is distinct from old.public_slug then
    raise exception 'certificate identity/range/slug columns are immutable after creation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
alter function private.guard_certificates_identity_change() owner to postgres;

-- Recreate trigger on the expanded column list (public_slug added).
drop trigger if exists t_guard_certificates_identity on public.certificates;
create trigger t_guard_certificates_identity
  before update of student_id, certificate_type, milestone_key,
                   cited_range_start, cited_range_end, public_slug
  on public.certificates
  for each row execute function private.guard_certificates_identity_change();
