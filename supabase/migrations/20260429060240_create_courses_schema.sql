-- Recorded courses platform — Stage 1 schema (6 tables, RLS, indexes, flags).
--
-- Pure-additive change: no existing public.* table touched, no existing
-- columns altered. Whole feature gated by `courses_enabled` (default false)
-- so flipping that one row OFF makes the platform invisible without losing
-- data.
--
-- RLS uses the canonical pattern from 20260429052950 — every table has
-- exactly four permissive policies (one per cmd) and zero cmd=ALL admin
-- policies, so the perf advisor's `multiple_permissive_policies` lint
-- doesn't fire as soon as we add data.
--
-- Helpers reused: `private.is_admin()`, `private.is_admin_or_mod()`
-- (moved from public→private in 20260428203550). Trigger function
-- `public.set_updated_at()` already exists in v9 schema.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. courses — top-level course entity
-- ═════════════════════════════════════════════════════════════════════════

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  slug text not null unique,

  -- bilingual content (Arabic required, English optional)
  title_ar text not null,
  title_en text,
  description_ar text,
  description_en text,

  -- media
  cover_image_url text,
  intro_bunny_video_id text,                                 -- optional preview reel

  -- pricing
  pricing_type text not null default 'free'
    check (pricing_type in ('free','one_time')),
  price_cents int not null default 0
    check (price_cents >= 0),
  currency text not null default 'USD'
    check (currency in ('USD','EGP')),

  -- classification
  level text check (level in ('beginner','intermediate','advanced')),
  language text check (language in ('ar','en','both')),
  specialty text,

  -- state machine
  status text not null default 'draft'
    check (status in ('draft','pending_review','published','archived','rejected')),
  rejection_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,

  -- cached aggregates (kept fresh by trigger / nightly reconcile)
  duration_seconds_cached int default 0,
  lesson_count_cached int default 0,
  enrollment_count_cached int default 0,
  rating_avg_cached numeric(3,2),
  rating_count_cached int default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- pricing must match: free implies zero price; one_time implies > 0
  constraint courses_pricing_consistent check (
    (pricing_type = 'free' and price_cents = 0)
    or (pricing_type = 'one_time' and price_cents > 0)
  )
);

create index idx_courses_status_published_at on public.courses (status, published_at desc) where deleted_at is null;
create index idx_courses_teacher_id          on public.courses (teacher_id, status);
create index idx_courses_specialty           on public.courses (specialty) where status = 'published';
create index idx_courses_reviewed_by         on public.courses (reviewed_by);

create trigger courses_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

alter table public.courses enable row level security;

create policy courses_select on public.courses
  for select
  using (
    (select private.is_admin_or_mod())
    or teacher_id = (select auth.uid())
    or status = 'published'
  );

create policy courses_insert on public.courses
  for insert
  with check (
    (select private.is_admin())
    or (
      teacher_id = (select auth.uid())
      and status = 'draft'
    )
  );

create policy courses_update on public.courses
  for update
  using (
    (select private.is_admin())
    or (
      teacher_id = (select auth.uid())
      and status in ('draft','pending_review','rejected')
    )
  )
  with check (
    (select private.is_admin())
    or (
      teacher_id = (select auth.uid())
      and status in ('draft','pending_review','rejected')
    )
  );

create policy courses_delete on public.courses
  for delete
  using (
    (select private.is_admin())
    or (
      teacher_id = (select auth.uid())
      and status = 'draft'
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 2. course_enrollments — student × course
--    (Defined before course_lessons because course_lessons RLS references
--    this table for "is the viewer enrolled?" checks. Postgres validates
--    policy expressions at creation time, so the referenced table must
--    already exist.)
-- ═════════════════════════════════════════════════════════════════════════

create table public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,

  source text not null check (source in ('free','purchase','admin_grant')),
  payment_id uuid references public.payments(id) on delete set null,

  -- revenue split snapshot (immutable after creation)
  amount_paid_cents int default 0,
  platform_fee_cents int default 0,
  teacher_earnings_cents int default 0,
  currency text check (currency in ('USD','EGP')),

  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  last_accessed_at timestamptz,

  unique (student_id, course_id)
);

create index idx_course_enrollments_student_id on public.course_enrollments (student_id, enrolled_at desc);
create index idx_course_enrollments_course_id  on public.course_enrollments (course_id);
create index idx_course_enrollments_payment_id on public.course_enrollments (payment_id);

alter table public.course_enrollments enable row level security;

create policy course_enrollments_select on public.course_enrollments
  for select
  using (
    (select private.is_admin_or_mod())
    or student_id = (select auth.uid())
    or exists (
      select 1 from public.courses c
      where c.id = course_enrollments.course_id
        and c.teacher_id = (select auth.uid())
    )
  );

create policy course_enrollments_insert on public.course_enrollments
  for insert
  with check (
    (select private.is_admin())
    or (
      student_id = (select auth.uid())
      and source = 'free'
      and exists (
        select 1 from public.courses c
        where c.id = course_enrollments.course_id
          and c.status = 'published'
          and c.pricing_type = 'free'
      )
    )
  );

create policy course_enrollments_update on public.course_enrollments
  for update
  using ((select private.is_admin()) or student_id = (select auth.uid()))
  with check ((select private.is_admin()) or student_id = (select auth.uid()));

create policy course_enrollments_delete on public.course_enrollments
  for delete
  using ((select private.is_admin()));

-- ═════════════════════════════════════════════════════════════════════════
-- 3. course_lessons — ordered videos within a course
-- ═════════════════════════════════════════════════════════════════════════

create table public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  order_index int not null,

  title_ar text not null,
  title_en text,
  description_ar text,
  description_en text,

  -- Bunny.net Stream
  bunny_video_id text unique,
  video_status text not null default 'pending'
    check (video_status in ('pending','uploading','processing','ready','failed')),
  duration_seconds int,

  is_preview boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (course_id, order_index)
);

create index idx_course_lessons_course_id     on public.course_lessons (course_id, order_index);
create index idx_course_lessons_video_status  on public.course_lessons (video_status)
  where video_status in ('uploading','processing');

create trigger course_lessons_updated_at
  before update on public.course_lessons
  for each row execute function public.set_updated_at();

alter table public.course_lessons enable row level security;

-- Lessons readable by:
--   admin/mod, teacher who owns the parent course (any status, for editing),
--   anyone if parent course is published AND lesson.is_preview = true,
--   enrolled student if parent course is published.
create policy course_lessons_select on public.course_lessons
  for select
  using (
    (select private.is_admin_or_mod())
    or exists (
      select 1 from public.courses c
      where c.id = course_lessons.course_id
        and c.teacher_id = (select auth.uid())
    )
    or (
      exists (
        select 1 from public.courses c
        where c.id = course_lessons.course_id
          and c.status = 'published'
      )
      and (
        is_preview = true
        or exists (
          select 1 from public.course_enrollments e
          where e.course_id = course_lessons.course_id
            and e.student_id = (select auth.uid())
        )
      )
    )
  );

create policy course_lessons_insert on public.course_lessons
  for insert
  with check (
    (select private.is_admin())
    or exists (
      select 1 from public.courses c
      where c.id = course_lessons.course_id
        and c.teacher_id = (select auth.uid())
        and c.status in ('draft','rejected')
    )
  );

create policy course_lessons_update on public.course_lessons
  for update
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.courses c
      where c.id = course_lessons.course_id
        and c.teacher_id = (select auth.uid())
        and c.status in ('draft','pending_review','rejected')
    )
  )
  with check (
    (select private.is_admin())
    or exists (
      select 1 from public.courses c
      where c.id = course_lessons.course_id
        and c.teacher_id = (select auth.uid())
        and c.status in ('draft','pending_review','rejected')
    )
  );

create policy course_lessons_delete on public.course_lessons
  for delete
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.courses c
      where c.id = course_lessons.course_id
        and c.teacher_id = (select auth.uid())
        and c.status = 'draft'
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 4. course_lesson_progress — playback position + completion
-- ═════════════════════════════════════════════════════════════════════════

create table public.course_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.course_enrollments(id) on delete cascade,
  lesson_id uuid not null references public.course_lessons(id) on delete cascade,

  last_position_seconds int not null default 0,
  completed_at timestamptz,
  watch_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (enrollment_id, lesson_id)
);

create index idx_course_lesson_progress_lesson_id on public.course_lesson_progress (lesson_id);

create trigger course_lesson_progress_updated_at
  before update on public.course_lesson_progress
  for each row execute function public.set_updated_at();

alter table public.course_lesson_progress enable row level security;

create policy course_lesson_progress_select on public.course_lesson_progress
  for select
  using (
    (select private.is_admin_or_mod())
    or exists (
      select 1 from public.course_enrollments e
      where e.id = course_lesson_progress.enrollment_id
        and e.student_id = (select auth.uid())
    )
  );

create policy course_lesson_progress_insert on public.course_lesson_progress
  for insert
  with check (
    (select private.is_admin())
    or exists (
      select 1 from public.course_enrollments e
      where e.id = course_lesson_progress.enrollment_id
        and e.student_id = (select auth.uid())
    )
  );

create policy course_lesson_progress_update on public.course_lesson_progress
  for update
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.course_enrollments e
      where e.id = course_lesson_progress.enrollment_id
        and e.student_id = (select auth.uid())
    )
  )
  with check (
    (select private.is_admin())
    or exists (
      select 1 from public.course_enrollments e
      where e.id = course_lesson_progress.enrollment_id
        and e.student_id = (select auth.uid())
    )
  );

create policy course_lesson_progress_delete on public.course_lesson_progress
  for delete
  using ((select private.is_admin()));

-- ═════════════════════════════════════════════════════════════════════════
-- 5. course_reviews — student ratings + comments
-- ═════════════════════════════════════════════════════════════════════════

create table public.course_reviews (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  enrollment_id uuid not null references public.course_enrollments(id) on delete cascade,

  stars int not null check (stars between 1 and 5),
  comment text,
  status text not null default 'published'
    check (status in ('published','hidden')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (student_id, course_id)
);

create index idx_course_reviews_course_id     on public.course_reviews (course_id, status, created_at desc);
create index idx_course_reviews_student_id    on public.course_reviews (student_id);
create index idx_course_reviews_enrollment_id on public.course_reviews (enrollment_id);

create trigger course_reviews_updated_at
  before update on public.course_reviews
  for each row execute function public.set_updated_at();

alter table public.course_reviews enable row level security;

create policy course_reviews_select on public.course_reviews
  for select
  using (
    (select private.is_admin_or_mod())
    or status = 'published'
    or student_id = (select auth.uid())
  );

create policy course_reviews_insert on public.course_reviews
  for insert
  with check (
    (select private.is_admin())
    or (
      student_id = (select auth.uid())
      and exists (
        select 1 from public.course_enrollments e
        where e.id = course_reviews.enrollment_id
          and e.student_id = (select auth.uid())
      )
    )
  );

create policy course_reviews_update on public.course_reviews
  for update
  using ((select private.is_admin_or_mod()) or student_id = (select auth.uid()))
  with check ((select private.is_admin_or_mod()) or student_id = (select auth.uid()));

create policy course_reviews_delete on public.course_reviews
  for delete
  using ((select private.is_admin()));

-- ═════════════════════════════════════════════════════════════════════════
-- 6. course_payouts — teacher earnings ledger
-- ═════════════════════════════════════════════════════════════════════════

create table public.course_payouts (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,

  period_start date not null,
  period_end date not null,

  total_sales_cents int not null default 0,
  platform_fee_cents int not null default 0,
  teacher_earnings_cents int not null default 0,
  currency text not null check (currency in ('USD','EGP')),

  status text not null default 'pending'
    check (status in ('pending','paid')),
  paid_out_at timestamptz,
  payout_reference text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (period_end >= period_start),
  unique (teacher_id, period_start, period_end, currency)
);

create index idx_course_payouts_teacher_id on public.course_payouts (teacher_id, status, period_end desc);
create index idx_course_payouts_status     on public.course_payouts (status) where status = 'pending';

create trigger course_payouts_updated_at
  before update on public.course_payouts
  for each row execute function public.set_updated_at();

alter table public.course_payouts enable row level security;

create policy course_payouts_select on public.course_payouts
  for select
  using ((select private.is_admin()) or teacher_id = (select auth.uid()));

create policy course_payouts_insert on public.course_payouts
  for insert
  with check ((select private.is_admin()));

create policy course_payouts_update on public.course_payouts
  for update
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy course_payouts_delete on public.course_payouts
  for delete
  using ((select private.is_admin()));

-- ═════════════════════════════════════════════════════════════════════════
-- Feature flags — both default OFF, flipped explicitly per stage
-- ═════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (key, value, description, updated_at)
values
  ('courses_enabled', 'false',
    'Master toggle for the recorded courses platform. Hides nav links + blocks /courses route when off.',
    now()),
  ('paid_courses_enabled', 'false',
    'Enables Stripe Checkout for paid courses. Free courses still work when this is off; paid courses show "Coming soon" toast.',
    now())
on conflict (key) do nothing;

-- ═════════════════════════════════════════════════════════════════════════
-- Post-checks — fail-fast on schema or RLS bugs
-- ═════════════════════════════════════════════════════════════════════════

do $$
declare
  rls_table_count int;
  policy_count int;
  all_cmd_count int;
  flag_count int;
  expected_tables text[] := array[
    'courses','course_lessons','course_enrollments',
    'course_lesson_progress','course_reviews','course_payouts'
  ];
begin
  select count(*) into rls_table_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = any (expected_tables)
    and c.relrowsecurity = true;
  if rls_table_count <> 6 then
    raise exception 'Stage 1 post-check: expected 6 RLS-enabled tables, found %', rls_table_count;
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and permissive = 'PERMISSIVE'
    and tablename = any (expected_tables);
  if policy_count <> 24 then
    raise exception 'Stage 1 post-check: expected 24 RLS policies (4 per table * 6 tables), found %', policy_count;
  end if;

  select count(*) into all_cmd_count
  from pg_policies
  where schemaname = 'public'
    and cmd = 'ALL'
    and tablename = any (expected_tables);
  if all_cmd_count > 0 then
    raise exception 'Stage 1 post-check: % cmd=ALL policies on courses tables (canonical pattern violated)', all_cmd_count;
  end if;

  select count(*) into flag_count
  from public.platform_settings
  where key in ('courses_enabled','paid_courses_enabled');
  if flag_count <> 2 then
    raise exception 'Stage 1 post-check: expected 2 courses feature flags, found %', flag_count;
  end if;

  raise notice 'Stage 1: 6 tables, 24 RLS policies, 0 cmd=ALL, 2 feature flags — schema ready.';
end $$;
