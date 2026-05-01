-- Catch-up SQL: apply the 3 migrations from 2026-05-01 that the Supabase
-- Branching integration didn't pick up, then seed the community forum.
--
-- Symptom that led here: the `scripts/seed_community.sql` paste failed with
-- ERROR 42703: column "roles" does not exist — confirming
-- 20260501173121_multi_role_support never applied. The other two migrations
-- from the same push (group_sessions_phase1, group_sessions_phase2_offerings)
-- almost certainly didn't either.
--
-- All three migration blocks below are idempotent (use `if not exists` /
-- `do $$` guards) so this is safe to re-run. Paste the whole file into the
-- Supabase SQL Editor (signed in as alforqan.egy@gmail.com) and Run.

------------------------------------------------------------------------------
-- 1) MIGRATION 20260501173121 — multi-role profiles
------------------------------------------------------------------------------
alter table public.profiles add column if not exists roles user_role[];

update public.profiles
set roles = array[role]::user_role[]
where roles is null;

alter table public.profiles alter column roles set not null;

alter table public.profiles
  drop constraint if exists profiles_active_role_in_set;
alter table public.profiles
  add constraint profiles_active_role_in_set
  check (role = any(roles));

create index if not exists profiles_roles_gin
  on public.profiles using gin (roles);

------------------------------------------------------------------------------
-- 2) MIGRATION 20260501174844 — group_sessions phase 1
------------------------------------------------------------------------------
alter table public.bookings
  add column if not exists session_id uuid
    references public.sessions(id) on delete set null;

alter table public.sessions
  add column if not exists is_group boolean not null default false;
alter table public.sessions
  add column if not exists capacity int not null default 1;

alter table public.sessions
  drop constraint if exists sessions_capacity_range;
alter table public.sessions
  add constraint sessions_capacity_range
  check (capacity between 1 and 20);

update public.bookings b
set    session_id = s.id
from   public.sessions s
where  s.booking_id = b.id
  and  b.session_id is null;

create index if not exists bookings_session_id_idx
  on public.bookings(session_id);

------------------------------------------------------------------------------
-- 3) MIGRATION 20260501175419 — group_sessions phase 2 (class_offerings)
------------------------------------------------------------------------------
create table if not exists public.class_offerings (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid not null references public.profiles(id) on delete cascade,
  title           text not null check (length(title) between 1 and 200),
  description     text,
  scheduled_at    timestamptz not null,
  duration_min    int not null check (duration_min between 15 and 240),
  session_type    public.session_type not null,
  capacity        int not null check (capacity between 2 and 20),
  price_usd       numeric(10,2) not null check (price_usd >= 0),
  status          text not null default 'open'
                  check (status in ('open','full','confirmed','cancelled','completed')),
  session_id      uuid references public.sessions(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists class_offerings_set_updated_at on public.class_offerings;
create trigger class_offerings_set_updated_at
  before update on public.class_offerings
  for each row execute function public.set_updated_at();

create index if not exists class_offerings_teacher_id_idx
  on public.class_offerings(teacher_id);
create index if not exists class_offerings_status_scheduled_idx
  on public.class_offerings(status, scheduled_at);

alter table public.bookings
  add column if not exists class_offering_id uuid
    references public.class_offerings(id) on delete set null;

create index if not exists bookings_class_offering_id_idx
  on public.bookings(class_offering_id);

alter table public.class_offerings enable row level security;

drop policy if exists "teacher rw own offerings" on public.class_offerings;
create policy "teacher rw own offerings" on public.class_offerings
  for all
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

drop policy if exists "student read open offerings" on public.class_offerings;
create policy "student read open offerings" on public.class_offerings
  for select
  using (status in ('open', 'full', 'confirmed'));

drop policy if exists "admin mod manage offerings" on public.class_offerings;
create policy "admin mod manage offerings" on public.class_offerings
  for all
  using (public.is_admin_or_mod())
  with check (public.is_admin_or_mod());

------------------------------------------------------------------------------
-- 4) FLIP THE COMMUNITY FLAG ON
------------------------------------------------------------------------------
insert into public.platform_settings (key, value, description)
values ('community_enabled', 'true', 'Whether the /community forum is reachable')
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

------------------------------------------------------------------------------
-- 5) SEED 8 DEMO COMMUNITY THREADS + 5 REPLIES
--    (now safe to use roles[] since the migration above just landed)
------------------------------------------------------------------------------
with candidates as (
  select id
  from public.profiles
  where deleted_at is null
    and is_active = true
    and (role = 'student'
         or 'student' = any (coalesce(roles, array[role]::user_role[])))
  order by created_at asc
  limit 8
),
all_active as (
  select id from public.profiles
  where deleted_at is null and is_active = true
  order by created_at asc
  limit 8
),
authors as (
  select id from (
    select id from candidates
    union
    select id from all_active
  ) u
  limit 8
),
demo_threads(title_ar, title_en, body_ar, body_en, category, is_pinned) as (
  values
    ('[demo] أهلاً بكم في مجتمع فُرقان',
     '[demo] Welcome to the FURQAN community',
     'هذا المجتمع مساحة آمنة لمشاركة تجاربكم في تعلّم القرآن. شاركونا أهدافكم وأسئلتكم.',
     'This community is a safe space to share your Quran-learning journey. Tell us your goals and questions.',
     'general', true),
    ('[demo] أفضل وقت للحفظ — صباحاً أم بعد الفجر؟',
     '[demo] Best time to memorize — morning or after Fajr?',
     'جربتُ الحفظ بعد الفجر فوجدته أسرع تثبيتاً. ما تجاربكم؟',
     'I tried memorising after Fajr and found it sticks faster. What is your experience?',
     'hifz', false),
    ('[demo] قاعدة نون الساكنة — توضيح بسيط',
     '[demo] Noon Saakinah rules — a quick clarification',
     'الإظهار، الإدغام، الإقلاب، الإخفاء — أيها الأكثر صعوبة عليكم؟ ولماذا؟',
     'Idhhar, Idgham, Iqlab, Ikhfa — which is the hardest to apply, and why?',
     'tajweed', false),
    ('[demo] نصيحة لطفلي عمره ٧ سنوات يبدأ الحفظ',
     '[demo] Advice for my 7-year-old starting hifz',
     'أبدأ مع ابني وأبحث عن طريقة لطيفة تشجّعه دون ضغط. اقتراحاتكم؟',
     'Starting with my son and looking for a gentle approach that encourages without pressure. Suggestions?',
     'advice', false),
    ('[demo] كتاب "غاية المريد" مرجعاً للتجويد',
     '[demo] "Ghayat al-Mureed" as a Tajweed reference',
     'هل من قرأ هذا الكتاب؟ كم استفدتم منه مقارنة بشروح الفيديو؟',
     'Anyone read it? How does it compare to video lessons in your experience?',
     'resources', false),
    ('[demo] جدول مراجعة أسبوعي يعمل لي',
     '[demo] A weekly review schedule that works for me',
     'كل يوم: ربع جديد + ربعان مراجعة قريبة + جزء كامل مراجعة بعيدة. أشاركه عسى أن يفيد.',
     'Daily: 1/4 new + 2/4 recent review + 1 juz far review. Sharing in case it helps.',
     'hifz', false),
    ('[demo] صعوبة في تطبيق الإخفاء في القراءة السريعة',
     '[demo] Struggling with Ikhfa during fast recitation',
     'عند تسريع التلاوة يضيع منّي الإخفاء. هل من تمرين عملي للتثبيت؟',
     'When I speed up I lose the Ikhfa. Any practical drills to lock it in?',
     'tajweed', false),
    ('[demo] ما رأيكم بإضافة قسم "اقتراحات" للمنصة؟',
     '[demo] Should we add a "suggestions" section to the platform?',
     'مساحة منفصلة لمقترحات تحسين الموقع. ماذا تقترحون أن نضيف أولاً؟',
     'A dedicated section for platform improvement ideas. What would you propose first?',
     'general', false)
),
demo_with_authors as (
  select
    d.title_ar, d.title_en, d.body_ar, d.body_en, d.category, d.is_pinned,
    a.id as author_id,
    now() - (random() * interval '14 days') as created_ts
  from demo_threads d
  cross join lateral (
    select id from authors
    order by md5(d.title_ar || authors.id::text)
    limit 1
  ) a
)
insert into public.forum_threads (
  author_id, title_ar, title_en, body_ar, body_en, category,
  is_pinned, is_locked, is_hidden, reply_count, last_reply_at,
  created_at, updated_at
)
select
  author_id, title_ar, title_en, body_ar, body_en, category,
  is_pinned, false, false, 0, null,
  created_ts, created_ts
from demo_with_authors
where not exists (
  select 1 from public.forum_threads t
  where t.title_ar = demo_with_authors.title_ar
);

with seeded_threads as (
  select id, title_ar
  from public.forum_threads
  where title_ar like '[demo]%'
  order by created_at asc
  limit 3
),
reply_authors as (
  select id from public.profiles
  where deleted_at is null and is_active = true
  order by created_at desc
  limit 5
),
demo_replies(rownum, body_ar, body_en) as (
  values
    (1, 'أهلاً وسهلاً! سعيد بالانضمام.', 'Welcome — happy to be here!'),
    (2, 'أنا أيضاً أفضل بعد الفجر — التركيز عالٍ جداً.', 'I also prefer after Fajr — focus is much higher.'),
    (3, 'الإخفاء عندي الأصعب لأن المخرج دقيق.', 'For me Ikhfa is the hardest because the makhraj is subtle.'),
    (4, 'جرّب الترغيب بقصة قصيرة قبل الحفظ، يعمل مع أبنائي.', 'Try a short story before memorising — works with my kids.'),
    (5, 'الفيديوهات أوضح للمبتدئ، لكن الكتاب أعمق للمراجع.', 'Video is clearer for beginners; the book is deeper for review.')
)
insert into public.forum_replies (thread_id, author_id, body_ar, body_en, created_at)
select
  st.id,
  ra.id,
  dr.body_ar,
  dr.body_en,
  now() - (random() * interval '7 days')
from demo_replies dr
join (
  select id, row_number() over (order by created_at) as rn from seeded_threads
) st on st.rn = ((dr.rownum - 1) % 3) + 1
join (
  select id, row_number() over () as rn from reply_authors
) ra on ra.rn = ((dr.rownum - 1) % 5) + 1
where not exists (
  select 1 from public.forum_replies r
  where r.thread_id = st.id and r.body_ar = dr.body_ar
);

------------------------------------------------------------------------------
-- 6) SANITY REPORT
------------------------------------------------------------------------------
do $$
declare
  has_roles_col bool;
  has_session_id_col bool;
  has_class_offerings bool;
  null_roles_count int;
  thread_count int;
  reply_count int;
  flag_value text;
begin
  select count(*) > 0 into has_roles_col
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'roles';

  select count(*) > 0 into has_session_id_col
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'session_id';

  select count(*) > 0 into has_class_offerings
    from information_schema.tables
    where table_schema = 'public' and table_name = 'class_offerings';

  select count(*) into null_roles_count from public.profiles where roles is null;
  select count(*) into thread_count from public.forum_threads where title_ar like '[demo]%';
  select count(*) into reply_count from public.forum_replies r
    join public.forum_threads t on t.id = r.thread_id
    where t.title_ar like '[demo]%';
  select value into flag_value from public.platform_settings where key = 'community_enabled';

  raise notice '=== Catch-up complete ===';
  raise notice 'profiles.roles column exists: %', has_roles_col;
  raise notice 'bookings.session_id column exists: %', has_session_id_col;
  raise notice 'class_offerings table exists: %', has_class_offerings;
  raise notice 'profiles with NULL roles (should be 0): %', null_roles_count;
  raise notice 'community_enabled flag: %', flag_value;
  raise notice 'demo forum threads: %', thread_count;
  raise notice 'demo forum replies: %', reply_count;
  raise notice 'open https://furqan.today/community to see the seeded threads.';
end $$;
