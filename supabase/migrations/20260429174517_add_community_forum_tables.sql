-- 20260429174517_add_community_forum_tables.sql
-- Phase 11 of the 15-feature build plan: Community forum.
--
-- Moderated platform-wide discussion. Any logged-in user (student/
-- teacher) can post threads + replies. Likes are simple toggles.
-- Reports route to /admin/community for moderator action. Hidden
-- threads/replies are filtered from public reads.

create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title_ar text not null,
  title_en text,
  body_ar text not null,
  body_en text,
  category text not null default 'general',
  is_pinned boolean not null default false,
  is_locked boolean not null default false,
  is_hidden boolean not null default false,
  reply_count integer not null default 0,
  last_reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forum_threads_pin_recent_idx
  on public.forum_threads (is_hidden, is_pinned desc, last_reply_at desc nulls last, created_at desc);

create trigger forum_threads_set_updated_at
  before update on public.forum_threads
  for each row execute function public.set_updated_at();

create table if not exists public.forum_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body_ar text not null,
  body_en text,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forum_replies_thread_idx
  on public.forum_replies (thread_id, created_at);

create trigger forum_replies_set_updated_at
  before update on public.forum_replies
  for each row execute function public.set_updated_at();

-- Auto-update reply_count + last_reply_at on the parent thread.
create or replace function public.fn_forum_replies_after_insert()
returns trigger language plpgsql as $$
begin
  update public.forum_threads
    set reply_count = reply_count + 1,
        last_reply_at = new.created_at
    where id = new.thread_id;
  return new;
end;
$$;

create trigger forum_replies_after_insert
  after insert on public.forum_replies
  for each row execute function public.fn_forum_replies_after_insert();

create or replace function public.fn_forum_replies_after_delete()
returns trigger language plpgsql as $$
begin
  update public.forum_threads
    set reply_count = greatest(0, reply_count - 1)
    where id = old.thread_id;
  return old;
end;
$$;

create trigger forum_replies_after_delete
  after delete on public.forum_replies
  for each row execute function public.fn_forum_replies_after_delete();

-- Likes: composite PK so a user can only like a target once.
create table if not exists public.forum_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('thread', 'reply')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index if not exists forum_likes_target_idx
  on public.forum_likes (target_type, target_id);

-- Reports: any user can report any thread or reply; moderators resolve.
create table if not exists public.forum_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('thread', 'reply')),
  target_id uuid not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists forum_reports_pending_idx
  on public.forum_reports (status, created_at desc);

-- RLS:
--   Threads + replies: public read on non-hidden rows; logged-in users
--   write their own; admin/mod can write anything.
--   Likes: owner-only.
--   Reports: reporter sees their own; moderators see all.
alter table public.forum_threads enable row level security;
alter table public.forum_replies enable row level security;
alter table public.forum_likes enable row level security;
alter table public.forum_reports enable row level security;

create policy forum_threads_public_read on public.forum_threads
  for select using (is_hidden = false or private.is_admin_or_mod());
create policy forum_threads_owner_write on public.forum_threads
  for insert with check (auth.uid() = author_id);
create policy forum_threads_owner_update on public.forum_threads
  for update using (auth.uid() = author_id and is_hidden = false);
create policy forum_threads_owner_delete on public.forum_threads
  for delete using (auth.uid() = author_id);
create policy forum_threads_mod on public.forum_threads
  for all using (private.is_admin_or_mod());

create policy forum_replies_public_read on public.forum_replies
  for select using (is_hidden = false or private.is_admin_or_mod());
create policy forum_replies_owner_write on public.forum_replies
  for insert with check (auth.uid() = author_id);
create policy forum_replies_owner_update on public.forum_replies
  for update using (auth.uid() = author_id and is_hidden = false);
create policy forum_replies_owner_delete on public.forum_replies
  for delete using (auth.uid() = author_id);
create policy forum_replies_mod on public.forum_replies
  for all using (private.is_admin_or_mod());

create policy forum_likes_owner on public.forum_likes
  for all using (auth.uid() = user_id);

create policy forum_reports_owner_write on public.forum_reports
  for insert with check (auth.uid() = reporter_id);
create policy forum_reports_owner_read on public.forum_reports
  for select using (auth.uid() = reporter_id);
create policy forum_reports_mod on public.forum_reports
  for all using (private.is_admin_or_mod());

-- Feature flag default — OFF; admin must flip it on after reviewing
-- seeded categories and moderation policy.
insert into public.platform_settings (key, value, description)
select 'community_enabled', 'false', 'Enables /community forum + /admin/community moderation queue'
where not exists (
  select 1 from public.platform_settings where key = 'community_enabled'
);

comment on table public.forum_threads is
  'Community forum threads. Authored by any logged-in user; moderated by admin/mod via is_pinned/is_locked/is_hidden flags.';
comment on table public.forum_reports is
  'User-submitted reports of threads/replies that violate guidelines. Pending status routes to /admin/community for resolution.';
