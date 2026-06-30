-- spec 035 US3 — admin-managed, vetted testimonials.
--
-- Replaces the hardcoded `REVIEWS` array (rendered identically on ~4 public
-- pages) with a DB-backed, RLS-governed table the business curates. The public
-- site shows ONLY `is_published = true` rows, so nothing unverified reaches a
-- visitor. Writes are admin-only.
--
-- Expand/contract: purely additive (new table). No existing object is dropped,
-- renamed, retyped, or set NOT NULL — safe under scripts/check-migration-safety.sh.

create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  author_name text not null,
  author_location text,
  quote_ar text not null,
  quote_en text,
  -- A testimonial may credit a real teacher. Nullable; FK so a referenced
  -- teacher always resolves to a real profile (the render query further
  -- requires that teacher to be publicly listable). on delete set null keeps
  -- the quote but drops a stale credit.
  teacher_id uuid references public.profiles(id) on delete set null,
  is_published boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_testimonials_published
  on public.testimonials(is_published, display_order);

alter table public.testimonials enable row level security;

-- Public/anon may read ONLY published testimonials. Unpublished rows (drafts,
-- pending business verification) are invisible to anon and authenticated
-- non-admins.
drop policy if exists testimonials_select_published on public.testimonials;
create policy testimonials_select_published on public.testimonials
  for select using (is_published = true or private.is_admin());

-- Writes are admin-only. No anon/teacher write path exists.
drop policy if exists testimonials_admin_insert on public.testimonials;
create policy testimonials_admin_insert on public.testimonials
  for insert with check (private.is_admin());

drop policy if exists testimonials_admin_update on public.testimonials;
create policy testimonials_admin_update on public.testimonials
  for update using (private.is_admin()) with check (private.is_admin());

drop policy if exists testimonials_admin_delete on public.testimonials;
create policy testimonials_admin_delete on public.testimonials
  for delete using (private.is_admin());

-- One-time seed of the prior hardcoded marketing quotes, imported as
-- is_published = false. They are NOT shown publicly (the SELECT policy and the
-- render query both require is_published = true). This relocates the existing
-- copy into the admin tool so the business can verify, correct attribution, and
-- publish (or delete) — without the site silently losing or displaying
-- unverified social proof. Guarded so a re-apply doesn't duplicate.
do $$
begin
  if not exists (select 1 from public.testimonials) then
    insert into public.testimonials (author_name, author_location, quote_ar, quote_en, is_published, display_order) values
      ('Umm Habiba', 'London', 'ابني عمره ٥ سنوات ويحب جلساته كثيراً. معلمته رائعة جداً، ماشاء الله!', 'My 5-year-old son loves his sessions so much. His teacher is amazing, MashaAllah!', false, 1),
      ('Ali Imran', 'Manchester', 'الحمد لله راضٍ جداً عن مستوى التعليم والمعلمين. أنصح فرقان بشدة.', 'Alhamdulillah, very satisfied with the quality of teaching. Highly recommend FURQAN.', false, 2),
      ('Isra Hashimi', 'Toronto', 'طفلاي يتعلمان القراءة بالتجويد الصحيح. المعلمون محترفون ومتفانون.', 'Both my children are learning to read with proper Tajweed. The teachers are professional and dedicated.', false, 3),
      ('Shagufta Kanwal', 'Dubai', 'لم أتخيل أن التعلم عبر الإنترنت سيكون بهذا المستوى. الإدارة منظمة جداً.', 'I never imagined online learning could be this good. The management is very organized.', false, 4),
      ('Ahmed Yusuf', 'Sydney', 'معلمون ممتازون يجعلون طفلي منخرطاً في التعلم. خدمة العملاء على أعلى مستوى!', 'Excellent teachers who keep my child engaged. Customer service is top-notch!', false, 5),
      ('Annie Sheikh', 'New York', 'استطعت حجز ٤ جلسات أسبوعياً مع طفل رضيع! الجدول مرن جداً.', 'I managed to book 4 sessions a week even with a baby! The schedule is very flexible.', false, 6),
      ('Mahin Masood', 'Houston', 'مضى شهران على تعلم ابنتي وهي سعيدة جداً. المعلمة حنونة وصبورة.', 'It''s been two months and my daughter is very happy. Her teacher is kind and patient.', false, 7),
      ('Fatima Al-Sayed', 'Kuwait', 'أتممت حفظ جزء عمّ في ثلاثة أشهر بفضل الله ثم بفضل معلمي المتميز.', 'I completed memorizing Juz Amma in just three months, by the grace of Allah and my wonderful teacher.', false, 8);
  end if;
end $$;
