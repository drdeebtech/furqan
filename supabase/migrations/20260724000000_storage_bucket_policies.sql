-- 20260724000000_storage_bucket_policies.sql
--
-- Codify Supabase Storage bucket definitions + RLS policies (issue #690).
--
-- Until now these lived ONLY in the dashboard: zero storage-policy DDL in the
-- repo, so bucket access rules couldn't be code-reviewed, diffed, or
-- reproduced by a from-zero `supabase db reset`. This migration is an exact
-- transcription of production as of 2026-07-14 (verified via pg_policies /
-- storage.buckets) — it changes NOTHING in prod, it makes the existing rules
-- reproducible and reviewable.
--
-- Bucket inventory (public = served via getPublicUrl, no read policy needed;
-- private = every read goes through RLS):
--   blog-images     PUBLIC   admin-only writes (5 MiB, jpeg/png/webp)
--   homework-audio  PRIVATE  student CRUD on own {uid}/ folder; teacher read
--                            via homework_assignments ownership; admin/mod read
--                            (5 MiB, webm/mp4/ogg/mpeg)
--   resources       PUBLIC   admin-only writes
--   services        PUBLIC   no object policies (writes are service-role only)
--   teacher-avatars PUBLIC   no object policies (writes are service-role only;
--                            2 MiB, jpeg/png/webp)
--
-- PRIVILEGE GUARD (empirical, not predictive): whether the migration role may
-- CREATE POLICY on storage.objects varies by environment — local stacks allow
-- it (verified: local `postgres` creates storage policies despite owning
-- neither superuser nor supabase_storage_admin), hosted prod may refuse
-- (storage.objects owned by supabase_storage_admin; postgres not a member).
-- So: ATTEMPT the DDL and catch insufficient_privilege. Where permitted
-- (local fresh-apply, preview branches) the rules are recreated; where
-- refused the block no-ops atomically with a notice — prod already carries
-- these policies (dashboard-created) and the header above stays the reviewed
-- source of truth for parity.
-- expand-contract-ok: exception-guarded no-op where unprivileged; additive-only elsewhere.

do $$
begin

  -- ── Buckets (idempotent; never mutates an existing bucket) ────────────────
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('blog-images',     'blog-images',     true,  5242880, array['image/jpeg','image/png','image/webp']),
    ('homework-audio',  'homework-audio',  false, 5242880, array['audio/webm','audio/mp4','audio/ogg','audio/mpeg']),
    ('resources',       'resources',       true,  null,    null),
    ('services',        'services',        true,  null,    null),
    ('teacher-avatars', 'teacher-avatars', true,  2097152, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;

  -- ── blog-images: admin-only writes ────────────────────────────────────────
  drop policy if exists "blog_images admin insert" on storage.objects;
  create policy "blog_images admin insert" on storage.objects for insert
    with check ((bucket_id = 'blog-images'::text) and is_admin());

  drop policy if exists "blog_images admin update" on storage.objects;
  create policy "blog_images admin update" on storage.objects for update
    using ((bucket_id = 'blog-images'::text) and is_admin());

  drop policy if exists "blog_images admin delete" on storage.objects;
  create policy "blog_images admin delete" on storage.objects for delete
    using ((bucket_id = 'blog-images'::text) and is_admin());

  -- ── homework-audio: student owns {uid}/… folder ───────────────────────────
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

  -- ── resources: admin-only writes ──────────────────────────────────────────
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
    raise notice 'storage_bucket_policies: skipping — % may not manage storage.objects policies here (prod already has these via dashboard)', current_user;
end $$;
