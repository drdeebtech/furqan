create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  keys_p256dh  text not null,
  keys_auth    text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create index push_subscriptions_user_id_idx
  on public.push_subscriptions(user_id);
