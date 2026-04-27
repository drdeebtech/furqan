-- v16_001: CMS-lite tables for marketing copy that admins should edit
-- without code deploys. Three thin tables, all read-public-write-admin.

-- ─── site_faqs ─────────────────────────────────────────────────────────
create table if not exists site_faqs (
  id uuid primary key default gen_random_uuid(),
  sort_order int not null default 100,
  question_ar text not null,
  question_en text not null,
  answer_ar text not null,
  answer_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_faqs_active_order on site_faqs(is_active, sort_order);

-- ─── site_features ─────────────────────────────────────────────────────
-- Generic feature/value-prop block keyed by `slot`. Slots in use today:
--   home_how_it_works | home_why_us | home_subjects |
--   home_trust_strip  | home_package_preview | about_values
-- `meta` jsonb carries slot-specific extras (level_ar/en, freq_ar/en, featured).
create table if not exists site_features (
  id uuid primary key default gen_random_uuid(),
  slot text not null,
  sort_order int not null default 100,
  icon_name text not null,
  title_ar text not null,
  title_en text not null,
  description_ar text,
  description_en text,
  meta jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_features_slot_active_order
  on site_features(slot, is_active, sort_order);

-- ─── site_blog_categories ──────────────────────────────────────────────
create table if not exists site_blog_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_ar text not null,
  label_en text not null,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_blog_categories_active_order
  on site_blog_categories(is_active, sort_order);

-- ─── updated_at trigger ────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'site_faqs_set_updated_at'
  ) then
    create trigger site_faqs_set_updated_at before update on site_faqs
      for each row execute function set_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'site_features_set_updated_at'
  ) then
    create trigger site_features_set_updated_at before update on site_features
      for each row execute function set_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'site_blog_categories_set_updated_at'
  ) then
    create trigger site_blog_categories_set_updated_at before update on site_blog_categories
      for each row execute function set_updated_at();
  end if;
end$$;

-- ─── RLS ───────────────────────────────────────────────────────────────
alter table site_faqs enable row level security;
alter table site_features enable row level security;
alter table site_blog_categories enable row level security;

drop policy if exists site_faqs_anon_read on site_faqs;
create policy site_faqs_anon_read on site_faqs for select using (is_active);
drop policy if exists site_faqs_admin_write on site_faqs;
create policy site_faqs_admin_write on site_faqs for all using (is_admin()) with check (is_admin());

drop policy if exists site_features_anon_read on site_features;
create policy site_features_anon_read on site_features for select using (is_active);
drop policy if exists site_features_admin_write on site_features;
create policy site_features_admin_write on site_features for all using (is_admin()) with check (is_admin());

drop policy if exists site_blog_cat_anon_read on site_blog_categories;
create policy site_blog_cat_anon_read on site_blog_categories for select using (is_active);
drop policy if exists site_blog_cat_admin_write on site_blog_categories;
create policy site_blog_cat_admin_write on site_blog_categories for all using (is_admin()) with check (is_admin());

-- ─── Seed (idempotent — only insert if table is empty per slot) ────────
do $$
begin
  if not exists (select 1 from site_faqs) then
    insert into site_faqs (sort_order, question_ar, question_en, answer_ar, answer_en) values
      (10, 'كيف أسجل في الأكاديمية؟', 'How do I register?',
       'أنشئ حساباً مجانياً على المنصة، ثم اختر معلمك واحجز جلستك الأولى. التسجيل سهل ولا يستغرق أكثر من دقيقة.',
       'Create a free account on the platform, then choose your teacher and book your first session. Registration is easy and takes less than a minute.'),
      (20, 'كيف تتم الجلسات؟', 'How do sessions work?',
       'تتم الجلسات عبر نظام الفيديو المدمج في منصة فرقان. بعد تأكيد الحجز ستحصل على رابط الجلسة مباشرة.',
       'Sessions are conducted via the built-in video system in the FURQAN platform. After booking confirmation, you''ll receive a session link directly.'),
      (30, 'هل يتوفر معلمات للأخوات؟', 'Are female teachers available?',
       'نعم، لدينا معلمات متخصصات ومعتمدات للأخوات والأطفال في بيئة آمنة تماماً.',
       'Yes, we have specialized and certified female teachers for sisters and children in a completely safe environment.'),
      (40, 'ما هي مؤهلات المعلمين؟', 'What are the teachers'' qualifications?',
       'جميع معلمينا حاصلون على إجازة في رواية حفص عن عاصم من علماء معتمدين، وخريجو جامعات إسلامية مرموقة.',
       'All our teachers hold Ijazah in Hafs narration from certified scholars and are graduates of prestigious Islamic universities.'),
      (50, 'هل يمكنني تغيير موعد جلستي؟', 'Can I reschedule my session?',
       'نعم، يمكنك إعادة الجدولة قبل ٢٤ ساعة من الجلسة بدون أي رسوم إضافية.',
       'Yes, you can reschedule up to 24 hours before the session at no additional cost.'),
      (60, 'ما مدة العقد الأدنى؟', 'What is the minimum contract?',
       'لا يوجد عقد. يمكنك الاشتراك شهراً بشهر وإلغاء الاشتراك في أي وقت بدون رسوم.',
       'There is no contract. You can subscribe month-to-month and cancel anytime with no fees.'),
      (70, 'هل يتوفر برنامج للأطفال؟', 'Is there a children''s program?',
       'نعم، لدينا برنامج خاص بالأطفال من سن ٥ سنوات بأسلوب تعليمي ممتع ومناسب لأعمارهم.',
       'Yes, we have a special program for children from age 5 with a fun and age-appropriate teaching style.'),
      (80, 'كيف أتابع تقدم طفلي؟', 'How do I track my child''s progress?',
       'يحصل ولي الأمر على تقرير تقدم مفصل بعد كل جلسة، ويمكنه متابعة لوحة التقدم في حساب الطالب.',
       'Parents receive a detailed progress report after each session and can monitor the progress dashboard in the student account.');
  end if;

  if not exists (select 1 from site_features where slot = 'home_how_it_works') then
    insert into site_features (slot, sort_order, icon_name, title_ar, title_en, description_ar, description_en) values
      ('home_how_it_works', 10, 'Users', 'سجّل حسابك', 'Create Account',
       'أنشئ حسابك مجاناً في أقل من دقيقة.', 'Create your free account in under a minute.'),
      ('home_how_it_works', 20, 'Calendar', 'اختر معلمك', 'Choose Teacher',
       'تصفح المعلمين المعتمدين واختر الأنسب لمستواك.', 'Browse certified teachers and pick the best match.'),
      ('home_how_it_works', 30, 'Video', 'ابدأ التعلم', 'Start Learning',
       'انضم لجلستك المباشرة عبر الفيديو المدمج.', 'Join your live session via the built-in video.');
  end if;

  if not exists (select 1 from site_features where slot = 'home_why_us') then
    insert into site_features (slot, sort_order, icon_name, title_ar, title_en, description_ar, description_en) values
      ('home_why_us', 10, 'Shield', 'معلمون معتمدون بالإجازة', 'Certified with Ijazah',
       'جميع معلمينا حاصلون على إجازة من كبار العلماء', 'All teachers hold Ijazah from senior scholars'),
      ('home_why_us', 20, 'Video', 'جلسات فيديو مدمجة', 'Built-in Video',
       'لا حاجة لزوم أو سكايب — الفيديو مدمج في المنصة', 'No Zoom or Skype — video is built into the platform'),
      ('home_why_us', 30, 'Calendar', 'جدول مرن يناسبك', 'Flexible Schedule',
       'احجز في أي وقت — صباحاً أو مساءً، ٧ أيام', 'Book any time — morning or evening, 7 days a week'),
      ('home_why_us', 40, 'Users', 'جلسات فردية ١:١', '1-on-1 Sessions',
       'كل طالب يحصل على اهتمام كامل من معلمه', 'Every student gets full attention from their teacher'),
      ('home_why_us', 50, 'Star', 'معلمات للأخوات والأطفال', 'Female Teachers',
       'متاح معلمات متخصصات في بيئة آمنة', 'Female teachers available for sisters and children'),
      ('home_why_us', 60, 'TrendingUp', 'تتبع تقدمك', 'Track Progress',
       'لوحة تحكم تعرض تقدمك في الحفظ والجلسات', 'Dashboard showing your memorization progress'),
      ('home_why_us', 70, 'Globe', 'نخدم طلاباً حول العالم', 'Worldwide Access',
       'تعلّم من أي مكان — أمريكا، أوروبا، الخليج، أستراليا', 'Learn from anywhere — USA, Europe, Gulf, Australia');
  end if;

  if not exists (select 1 from site_features where slot = 'home_subjects') then
    insert into site_features (slot, sort_order, icon_name, title_ar, title_en, description_ar, description_en, meta) values
      ('home_subjects', 10, 'Star', 'التلاوة', 'Recitation',
       'ابدأ بالقراءة الصحيحة مع شيخ متخصص.', 'Start here: correct reading with a specialist sheikh.',
       '{"level_ar":"للمبتدئين","level_en":"Beginner"}'::jsonb),
      ('home_subjects', 20, 'CheckCircle', 'التجويد', 'Tajweed',
       'أحكام التلاوة بأسلوب علمي ممنهج.', 'Recitation rules with a structured approach.',
       '{"level_ar":"للمبتدئين","level_en":"Beginner"}'::jsonb),
      ('home_subjects', 30, 'BookOpen', 'حفظ القرآن', 'Quran Memorization',
       'احفظ كتاب الله بمنهج تدريجي.', 'Memorize with a graduated plan.',
       '{"level_ar":"مستوى متوسط","level_en":"Intermediate"}'::jsonb),
      ('home_subjects', 40, 'TrendingUp', 'المراجعة', 'Revision',
       'راجع محفوظاتك مع معلم يتابع تقدمك.', 'Review memorization with progress tracking.',
       '{"level_ar":"مستوى متوسط","level_en":"Intermediate"}'::jsonb),
      ('home_subjects', 50, 'Globe', 'القراءات', 'Qira''at',
       'روايات حفص وورش وقالون والدوري.', 'Hafs, Warsh, Qalun, and Al-Duri readings.',
       '{"level_ar":"مستوى متقدم","level_en":"Advanced"}'::jsonb),
      ('home_subjects', 60, 'Award', 'التفسير', 'Tafsir',
       'معاني القرآن وتدبّر آياته.', 'Quran meanings and deep reflection.',
       '{"level_ar":"مستوى متقدم","level_en":"Advanced"}'::jsonb);
  end if;

  if not exists (select 1 from site_features where slot = 'home_trust_strip') then
    insert into site_features (slot, sort_order, icon_name, title_ar, title_en) values
      ('home_trust_strip', 10, 'GraduationCap', 'خريجو جامعة الأزهر', 'Al-Azhar Graduates'),
      ('home_trust_strip', 20, 'Shield', 'إجازة في رواية حفص', 'Hafs Ijazah Certified'),
      ('home_trust_strip', 30, 'Globe', 'طلاب من ٣٠+ دولة', 'Students from 30+ countries');
  end if;

  if not exists (select 1 from site_features where slot = 'home_package_preview') then
    insert into site_features (slot, sort_order, icon_name, title_ar, title_en, meta) values
      ('home_package_preview', 10, 'Package', 'الباقة الأساسية', 'Starter',
       '{"freq_ar":"٢ أيام/أسبوع · ٨ جلسات","freq_en":"2 days/week · 8 sessions","featured":false}'::jsonb),
      ('home_package_preview', 20, 'Package', 'الباقة المتوسطة', 'Standard',
       '{"freq_ar":"٣ أيام/أسبوع · ١٢ جلسة","freq_en":"3 days/week · 12 sessions","featured":false}'::jsonb),
      ('home_package_preview', 30, 'Package', 'الباقة المتقدمة', 'Premium',
       '{"freq_ar":"٥ أيام/أسبوع · ٢٠ جلسة","freq_en":"5 days/week · 20 sessions","featured":true}'::jsonb),
      ('home_package_preview', 40, 'Package', 'باقة نهاية الأسبوع', 'Weekend',
       '{"freq_ar":"السبت والأحد · ٨ جلسات","freq_en":"Sat & Sun · 8 sessions","featured":false}'::jsonb);
  end if;

  if not exists (select 1 from site_features where slot = 'about_values') then
    insert into site_features (slot, sort_order, icon_name, title_ar, title_en, description_ar, description_en) values
      ('about_values', 10, 'Heart', 'الإخلاص في الخدمة', 'Sincere Service',
       'نؤمن بأن تعليم القرآن أمانة عظيمة نسعى لأدائها بإتقان',
       'We believe teaching Quran is a great trust we strive to fulfill with excellence'),
      ('about_values', 20, 'Users', 'الاهتمام الفردي', 'Individual Attention',
       'كل طالب يحصل على اهتمام كامل ومنهج مخصص لأهدافه',
       'Every student gets full attention and a customized plan for their goals'),
      ('about_values', 30, 'Clock', 'المرونة والالتزام', 'Flexibility & Commitment',
       'نحترم وقتك ونلتزم بالمواعيد مع مرونة كاملة في الجدولة',
       'We respect your time and commit to schedules with full scheduling flexibility'),
      ('about_values', 40, 'Globe', 'خدمة الأمة', 'Serving the Ummah',
       'نسعى لخدمة المسلمين في كل مكان وتسهيل تعلم القرآن للجميع',
       'We strive to serve Muslims everywhere and make Quran learning accessible to all');
  end if;

  if not exists (select 1 from site_blog_categories) then
    insert into site_blog_categories (key, label_ar, label_en, sort_order) values
      ('all', 'الكل', 'All', 10),
      ('Hifz', 'حفظ القرآن', 'Hifz', 20),
      ('Tajweed', 'تجويد', 'Tajweed', 30),
      ('Tips', 'نصائح', 'Tips', 40),
      ('Children', 'للأطفال', 'Children', 50),
      ('Qiraat', 'القراءات', 'Qira''at', 60);
  end if;
end$$;

insert into schema_migrations (version, description)
  values ('v16_001', 'site_faqs + site_features + site_blog_categories (CMS-lite)')
  on conflict do nothing;
