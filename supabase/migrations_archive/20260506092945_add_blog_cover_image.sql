-- 20260506092945_add_blog_cover_image.sql
-- Adds cover image support to blog posts. Admin uploads a JPEG/PNG/WebP
-- in the post form, types alt-text in both languages by hand (no AI),
-- and the public blog renders the cover with the right alt per locale.
--
-- This migration introduces:
--   1. Three columns on blog_posts: cover_image_path, cover_alt_en, cover_alt_ar
--   2. New 'blog-images' storage bucket (public read, admin-only write)
--   3. Storage RLS policies on the new bucket
--
-- Path convention enforced by the upload UI:
--   blog-images/{post_id}/cover.{ext}
-- The first folder is the post id; the file name is always 'cover' so a
-- second upload overwrites the first (upsert: true on the upload call).

-- ─── Columns on blog_posts ──────────────────────────────────────────────────

alter table public.blog_posts
  add column if not exists cover_image_path text,
  add column if not exists cover_alt_en text,
  add column if not exists cover_alt_ar text;

comment on column public.blog_posts.cover_image_path is
  'Storage path inside the blog-images bucket. Format: {post_id}/cover.{ext}. NULL when no hero image is set.';
comment on column public.blog_posts.cover_alt_en is
  'English alt-text for the cover image. Typed by the admin in /admin/blog/[id]/edit.';
comment on column public.blog_posts.cover_alt_ar is
  'Arabic alt-text for the cover image. Typed by the admin in /admin/blog/[id]/edit.';

create index if not exists blog_posts_cover_image_path_idx
  on public.blog_posts (cover_image_path)
  where cover_image_path is not null;

-- ─── Storage bucket ─────────────────────────────────────────────────────────

-- Public bucket: covers are served straight from the public URL (no signed
-- URLs needed, CDN-friendly). 5 MiB cap; restricted to web-friendly image
-- MIME types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blog-images',
  'blog-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ─── Storage RLS for blog-images ────────────────────────────────────────────

-- Anyone can read (bucket is public, but explicit policy makes the intent
-- clear and survives future bucket-level toggles).
drop policy if exists "blog_images public read" on storage.objects;
create policy "blog_images public read"
  on storage.objects for select
  using (bucket_id = 'blog-images');

-- Only admins can insert/update/delete.
drop policy if exists "blog_images admin insert" on storage.objects;
create policy "blog_images admin insert"
  on storage.objects for insert
  with check (bucket_id = 'blog-images' and public.is_admin());

drop policy if exists "blog_images admin update" on storage.objects;
create policy "blog_images admin update"
  on storage.objects for update
  using (bucket_id = 'blog-images' and public.is_admin());

drop policy if exists "blog_images admin delete" on storage.objects;
create policy "blog_images admin delete"
  on storage.objects for delete
  using (bucket_id = 'blog-images' and public.is_admin());
