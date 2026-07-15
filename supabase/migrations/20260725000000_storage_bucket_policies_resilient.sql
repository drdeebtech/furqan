-- 20260725000000_storage_bucket_policies_resilient.sql
--
-- Hardening follow-up to 20260724000000_storage_bucket_policies.sql
-- (CodeRabbit, #696): in that migration the bucket INSERT and the policy DDL
-- share ONE exception-guarded block. Because a PL/pgSQL block with an EXCEPTION
-- clause is a subtransaction, a policy hitting `insufficient_privilege` rolls
-- the WHOLE block back — including the `storage.buckets` insert. On a from-zero
-- apply in some future privilege split (role may write buckets but not create
-- storage.objects policies) that would leave the database with no buckets.
--
-- Fix: split the two concerns into independent nested guarded sub-blocks, so
-- bucket definitions persist regardless of whether policy creation is permitted.
-- Fully idempotent — safe to re-apply anywhere:
--   * buckets   : INSERT ... ON CONFLICT (id) DO NOTHING
--   * policies  : DROP POLICY IF EXISTS ... then CREATE POLICY ...
--
-- Environment behaviour is NOT asserted here. Whether the migration role
-- applies or skips each sub-block depends on its storage privileges, which vary
-- by environment and which read-only access cannot probe for CREATE POLICY.
-- What IS verified (2026-07-14, via storage.buckets / pg_policies): production
-- already carries all 5 buckets and the 12 storage.objects policies below, and
-- a from-zero `supabase db reset` reproduces them. This migration only makes
-- that reproduction resilient to a policy-privilege failure.
--
-- expand-contract-ok: idempotent additive re-assertion; DROP POLICY IF EXISTS is
-- immediately followed by CREATE POLICY of the same name (no window, no breaker).

do $$
begin
  -- ── Buckets — own guard: must survive a policy-privilege failure ──────────
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('blog-images',     'blog-images',     true,  5242880, array['image/jpeg','image/png','image/webp']),
      ('homework-audio',  'homework-audio',  false, 5242880, array['audio/webm','audio/mp4','audio/ogg','audio/mpeg']),
      ('resources',       'resources',       true,  null,    null),
      ('services',        'services',        true,  null,    null),
      ('teacher-avatars', 'teacher-avatars', true,  2097152, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;
  exception
    when insufficient_privilege then
      raise notice 'storage_bucket_policies_resilient: bucket insert skipped — % may not write storage.buckets here', current_user;
  end;

  -- ── Policies — own guard: a privilege failure here cannot touch buckets ───
  begin
    -- blog-images: admin-only writes
    drop policy if exists "blog_images admin insert" on storage.objects;
    create policy "blog_images admin insert" on storage.objects for insert
      with check ((bucket_id = 'blog-images'::text) and is_admin());

    drop policy if exists "blog_images admin update" on storage.objects;
    create policy "blog_images admin update" on storage.objects for update
      using ((bucket_id = 'blog-images'::text) and is_admin());

    drop policy if exists "blog_images admin delete" on storage.objects;
    create policy "blog_images admin delete" on storage.objects for delete
      using ((bucket_id = 'blog-images'::text) and is_admin());

    -- homework-audio: student owns {uid}/… folder
    drop policy if exists "homework_audio student insert" on storage.objects;
    create policy "homework_audio student insert" on storage.objects for insert
      with check ((bucket_id = 'homework-audio'::text) and (auth.uid() is not null)
        and ((storage.foldername(name))[1] = (auth.uid())::text));

    drop policy if exists "homework_audio student read" on storage.objects;
    create policy "homework_audio student read" on storage.objects for select
      using ((bucket_id = 'homework-audio'::text) and (auth.uid() is not null)
        and ((storage.foldername(name))[1] = (auth.uid())::text));

    drop policy if exists "homework_audio student update" on storage.objects;
    create policy "homework_audio student update" on storage.objects for update
      using ((bucket_id = 'homework-audio'::text) and (auth.uid() is not null)
        and ((storage.foldername(name))[1] = (auth.uid())::text));

    drop policy if exists "homework_audio student delete" on storage.objects;
    create policy "homework_audio student delete" on storage.objects for delete
      using ((bucket_id = 'homework-audio'::text) and (auth.uid() is not null)
        and ((storage.foldername(name))[1] = (auth.uid())::text));

    -- teacher may read a submission only for homework they assigned
    drop policy if exists "homework_audio teacher read" on storage.objects;
    create policy "homework_audio teacher read" on storage.objects for select
      using ((bucket_id = 'homework-audio'::text) and (auth.uid() is not null)
        and (exists ( select 1 from homework_assignments h
          where ((h.teacher_id = auth.uid())
            and ((h.id)::text = (storage.foldername(objects.name))[2])))));

    drop policy if exists "homework_audio admin read" on storage.objects;
    create policy "homework_audio admin read" on storage.objects for select
      using ((bucket_id = 'homework-audio'::text) and is_admin_or_mod());

    -- resources: admin-only writes
    drop policy if exists "resources bucket admin write" on storage.objects;
    create policy "resources bucket admin write" on storage.objects for insert
      with check ((bucket_id = 'resources'::text) and is_admin());

    drop policy if exists "resources bucket admin update" on storage.objects;
    create policy "resources bucket admin update" on storage.objects for update
      using ((bucket_id = 'resources'::text) and is_admin());

    drop policy if exists "resources bucket admin delete" on storage.objects;
    create policy "resources bucket admin delete" on storage.objects for delete
      using ((bucket_id = 'resources'::text) and is_admin());
  exception
    when insufficient_privilege then
      raise notice 'storage_bucket_policies_resilient: policy DDL skipped — % may not manage storage.objects policies here (prod already has these via dashboard)', current_user;
  end;
end $$;
