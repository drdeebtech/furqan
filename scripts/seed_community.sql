-- Seed sample community forum threads + a few replies, plus flip the
-- community_enabled feature flag on. Paste this whole file into the Supabase
-- SQL Editor (signed in as alforqan.egy@gmail.com) and run.
--
-- Idempotent: re-running won't duplicate the demo threads. Safe to delete
-- the rows later via WHERE category = 'general' AND title_ar LIKE '[demo]%'.
-- Author IDs are picked dynamically from existing profiles so this works
-- without knowing specific UUIDs.

-- 1. Flip the community_enabled feature flag on.
insert into public.platform_settings (key, value, description)
values ('community_enabled', 'true', 'Whether the /community forum is reachable')
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

-- 2. Pick 8 author candidates: prefer students (multi-role-aware), fall
--    back to any non-deleted profile if there aren't enough students.
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
  select id, row_number() over (order by id) as n
  from (
    select id from candidates
    union all
    select id from all_active
  ) u
  group by id
  order by min(n)
  limit 8
),
-- Compose 8 demo threads tagged "[demo]" so they're easy to delete later.
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
    -- Stagger created_at over the past 14 days so the list looks lived-in.
    now() - (random() * interval '14 days') as created_ts
  from demo_threads d
  cross join lateral (
    select id from authors
    order by md5(d.title_ar || authors.id::text)  -- deterministic per-thread author pick
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
  where t.title_ar = demo_with_authors.title_ar  -- idempotency guard
);

-- 3. A handful of replies on the first 3 demo threads so you can see the
--    reply_count + last_reply_at trigger in action.
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

-- Sanity report.
do $$
declare
  thread_count int;
  reply_count int;
  flag_value text;
begin
  select count(*) into thread_count from public.forum_threads where title_ar like '[demo]%';
  select count(*) into reply_count from public.forum_replies r
    join public.forum_threads t on t.id = r.thread_id
    where t.title_ar like '[demo]%';
  select value into flag_value from public.platform_settings where key = 'community_enabled';

  raise notice 'community_enabled = %', flag_value;
  raise notice 'demo threads: %', thread_count;
  raise notice 'demo replies: %', reply_count;
  raise notice 'open /community in your browser to see them.';
end $$;
