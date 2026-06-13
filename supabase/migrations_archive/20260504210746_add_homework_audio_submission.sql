-- 20260504210746_add_homework_audio_submission.sql
-- Item #9 of the deep pedagogical analysis (Project Memory/furqan/Runs/
-- 2026-05-04-2313-deep-pedagogical-analysis-student-benefit.md): lets a
-- student attach an audio recitation when marking homework "I'm Ready",
-- so the teacher can review async between sessions. Drops feedback
-- latency from a week (until next live session) to typically 24h.
--
-- This migration adds:
--   1. Two columns on homework_assignments (audio_url, audio_duration_seconds)
--   2. A private storage bucket 'homework-audio' with size + MIME limits
--   3. Storage RLS policies:
--      - Student INSERT/UPDATE/SELECT/DELETE own files (path[1] = uid)
--      - Teacher SELECT files referenced by homework_assignments rows
--        where teacher_id = uid (path-based lookup keeps it index-friendly)
--      - Admin/mod SELECT all
--
-- Path convention enforced by the upload UI:
--   homework-audio/{student_id}/{homework_id}/{timestamp}.webm
-- The first folder MUST equal the student's auth.uid() so the RLS check
-- works without joining homework_assignments on every read.

-- ─── Columns on homework_assignments ────────────────────────────────────────

alter table public.homework_assignments
  add column if not exists audio_url text,
  add column if not exists audio_duration_seconds integer;

alter table public.homework_assignments
  drop constraint if exists homework_assignments_audio_duration_check;
alter table public.homework_assignments
  add constraint homework_assignments_audio_duration_check
    check (
      audio_duration_seconds is null
      or (audio_duration_seconds >= 1 and audio_duration_seconds <= 300)
    );

comment on column public.homework_assignments.audio_url is
  'Storage path inside the homework-audio bucket. Format: {student_id}/{homework_id}/{ts}.webm. NULL when the student submitted without audio (still permitted).';
comment on column public.homework_assignments.audio_duration_seconds is
  'Length of the recorded audio in whole seconds. Constrained 1-300; UI caps at 90 by default but the schema is loose to allow future tuning.';

-- ─── Storage bucket ─────────────────────────────────────────────────────────

-- Private bucket: signed URLs required for playback. 5 MiB cap (≈4 min of
-- opus webm at typical bitrates — generous given the 90s UI cap). Allowed
-- MIME types restrict to formats browsers actually produce via MediaRecorder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'homework-audio',
  'homework-audio',
  false,
  5242880,
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ─── Storage RLS policies ───────────────────────────────────────────────────

-- Student writes own. The first folder MUST equal auth.uid()::text. The UI
-- enforces this; the RLS policy makes it impossible to bypass via raw API.
drop policy if exists "homework_audio student insert" on storage.objects;
create policy "homework_audio student insert"
  on storage.objects for insert
  with check (
    bucket_id = 'homework-audio'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "homework_audio student update" on storage.objects;
create policy "homework_audio student update"
  on storage.objects for update
  using (
    bucket_id = 'homework-audio'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "homework_audio student delete" on storage.objects;
create policy "homework_audio student delete"
  on storage.objects for delete
  using (
    bucket_id = 'homework-audio'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "homework_audio student read" on storage.objects;
create policy "homework_audio student read"
  on storage.objects for select
  using (
    bucket_id = 'homework-audio'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Teacher reads audio for any homework_assignments row they own. Path-based
-- check uses the homework_id (second folder) to look up teacher_id without
-- pulling the whole row.
drop policy if exists "homework_audio teacher read" on storage.objects;
create policy "homework_audio teacher read"
  on storage.objects for select
  using (
    bucket_id = 'homework-audio'
    and auth.uid() is not null
    and exists (
      select 1
      from public.homework_assignments h
      where h.teacher_id = auth.uid()
        and h.id::text = (storage.foldername(name))[2]
    )
  );

-- Admin/mod read all (operations support, audit, dispute resolution).
drop policy if exists "homework_audio admin read" on storage.objects;
create policy "homework_audio admin read"
  on storage.objects for select
  using (
    bucket_id = 'homework-audio'
    and public.is_admin_or_mod()
  );
