-- v15_008_teacher_picklists.sql
--
-- Move the teacher CV picklists (specialties, recitations, languages)
-- from frontend constants into the database. Today they live in
-- src/lib/constants.ts, which means adding "Aqeedah for kids" or fixing
-- a typo in an Arabic label requires a code deploy. With these tables
-- the admin can edit labels through Supabase Studio (or a future admin
-- page) and the change is live immediately.
--
-- Schema is identical for all three: a stable `key` (what we store on
-- teacher_profiles.specialties[]), bilingual labels, sort order, and an
-- is_active flag so a label can be retired without orphaning historical
-- data on existing teacher rows.
--
-- RLS: anon SELECT is allowed (the public teachers page needs labels);
-- writes are admin-only. is_admin() helper exists from earlier migrations.

create table if not exists public.teacher_specialties (
  key text primary key,
  label_ar text not null,
  label_en text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.teacher_recitations (
  key text primary key,
  label_ar text not null,
  label_en text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.teacher_languages (
  key text primary key,
  label_ar text not null,
  label_en text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.teacher_specialties enable row level security;
alter table public.teacher_recitations enable row level security;
alter table public.teacher_languages enable row level security;

-- Public read (anon + authenticated). Picklists are reference data — same as
-- showing prices on the public page.
drop policy if exists "specialties_read" on public.teacher_specialties;
create policy "specialties_read" on public.teacher_specialties for select using (true);

drop policy if exists "recitations_read" on public.teacher_recitations;
create policy "recitations_read" on public.teacher_recitations for select using (true);

drop policy if exists "languages_read" on public.teacher_languages;
create policy "languages_read" on public.teacher_languages for select using (true);

-- Admin-only writes (insert/update/delete). is_admin() is defined in earlier
-- v9 migration; if it's missing the policy fails closed which is correct.
drop policy if exists "specialties_admin_write" on public.teacher_specialties;
create policy "specialties_admin_write" on public.teacher_specialties for all
  using (is_admin()) with check (is_admin());

drop policy if exists "recitations_admin_write" on public.teacher_recitations;
create policy "recitations_admin_write" on public.teacher_recitations for all
  using (is_admin()) with check (is_admin());

drop policy if exists "languages_admin_write" on public.teacher_languages;
create policy "languages_admin_write" on public.teacher_languages for all
  using (is_admin()) with check (is_admin());

-- ─── Seed from constants.ts ─────────────────────────────────────────────────
-- Mirrors src/lib/constants.ts exactly so existing teacher rows keep their
-- labels. Idempotent via on conflict do nothing — re-running is safe.

insert into public.teacher_languages (key, label_ar, label_en, sort_order) values
  ('ar', 'العربية', 'Arabic', 10),
  ('en', 'الإنجليزية', 'English', 20),
  ('ur', 'الأوردية', 'Urdu', 30),
  ('fr', 'الفرنسية', 'French', 40),
  ('tr', 'التركية', 'Turkish', 50),
  ('id', 'الإندونيسية', 'Indonesian', 60),
  ('ms', 'الماليزية', 'Malay', 70)
on conflict (key) do nothing;

insert into public.teacher_recitations (key, label_ar, label_en, sort_order) values
  ('hafs',           'حفص عن عاصم',                'Hafs `an Asim',           10),
  ('shu_ba',         'شعبة عن عاصم',               'Shu''ba `an Asim',        20),
  ('warsh',          'ورش عن نافع',                'Warsh `an Nafi''',        30),
  ('qalon',          'قالون عن نافع',              'Qalon `an Nafi''',        40),
  ('al_duri_basri',  'الدوري عن أبي عمرو البصري',   'Al-Duri `an Abi Amr',     50),
  ('al_susi',        'السوسي عن أبي عمرو البصري',   'Al-Susi `an Abi Amr',     60),
  ('hisham',         'هشام عن ابن عامر',            'Hisham `an Ibn Amir',     70),
  ('ibn_dhakwan',    'ابن ذكوان عن ابن عامر',       'Ibn Dhakwan `an Ibn Amir',80),
  ('al_bazzi',       'البزي عن ابن كثير',           'Al-Bazzi `an Ibn Kathir', 90),
  ('qunbul',         'قنبل عن ابن كثير',            'Qunbul `an Ibn Kathir',   100),
  ('khalaf_hamzah',  'خلف عن حمزة',                'Khalaf `an Hamzah',       110),
  ('khallad',        'خلاد عن حمزة',               'Khallad `an Hamzah',      120)
on conflict (key) do nothing;

insert into public.teacher_specialties (key, label_ar, label_en, sort_order) values
  ('tajweed',          'التجويد',                                       'Tajweed',                                   10),
  ('memorization',     'الحفظ',                                          'Memorization (Hifz)',                       20),
  ('murajaa',          'مراجعة الحفظ',                                   'Hifz revision (Muraja''a)',                 30),
  ('qiraat',           'القراءات',                                       'Qira''at',                                  40),
  ('ijazah',           'الإجازة بالسند',                                 'Ijazah (chain of transmission)',            50),
  ('tafsir',           'التفسير',                                        'Tafsir',                                    60),
  ('arabic',           'اللغة العربية',                                  'Arabic language',                           70),
  ('quranic_arabic',   'نحو وصرف القرآن',                                'Quranic Arabic (Nahw & Sarf)',              80),
  ('kids',             'تعليم الأطفال',                                  'Kids',                                      90),
  ('adult_beginners',  'الكبار المبتدئون',                               'Adult beginners',                          100),
  ('reverts',          'المسلمون الجدد وغير الناطقين بالعربية',           'Reverts & non-Arabic speakers',            110),
  ('women_only',       'تعليم النساء فقط',                               'Women-only classes',                       120),
  ('salah_correction', 'تصحيح الصلاة وأحكامها',                          'Salah correction',                         130),
  ('dua_adhkar',       'الأدعية والأذكار',                               'Du''a & Adhkar',                           140),
  ('aqeedah',          'العقيدة',                                        'Aqeedah',                                  150),
  ('fiqh',             'الفقه',                                          'Fiqh',                                     160),
  ('hadith',           'الحديث الشريف',                                  'Hadith',                                   170),
  ('sirah',            'السيرة النبوية',                                 'Sirah',                                    180)
on conflict (key) do nothing;

insert into schema_migrations (version, description)
  values ('v15_008', 'Teacher picklists in DB (specialties, recitations, languages) + RLS + seed')
  on conflict do nothing;
