-- 20260429171328_add_help_center_tables.sql
-- Phase 5 of the 15-feature build plan: Help Center.
--
-- DB-backed knowledge base. Articles authored from /admin/help, served
-- publicly at /help. Categories are simple text slugs (no hierarchy);
-- each article belongs to exactly one. Bilingual: title_ar/title_en,
-- body_ar/body_en — Arabic required, English optional (mirrors the rest
-- of furqan).

create table if not exists public.help_categories (
  slug text primary key,
  label_ar text not null,
  label_en text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_ar text not null,
  title_en text,
  body_ar text not null,
  body_en text,
  category text not null references public.help_categories(slug) on update cascade,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists help_articles_category_published_idx
  on public.help_articles (category, is_published, sort_order);

create trigger help_articles_set_updated_at
  before update on public.help_articles
  for each row execute function public.set_updated_at();

-- RLS:
--   Public: read published articles + all categories.
--   Admin: full read/write.
alter table public.help_articles enable row level security;
alter table public.help_categories enable row level security;

create policy help_articles_public_read on public.help_articles
  for select using (is_published = true);
create policy help_categories_public_read on public.help_categories
  for select using (true);

create policy help_articles_admin_all on public.help_articles
  for all using (private.is_admin());
create policy help_categories_admin_all on public.help_categories
  for all using (private.is_admin());

-- Seed the starter categories so /admin/help isn't blank on first visit.
insert into public.help_categories (slug, label_ar, label_en, sort_order) values
  ('getting-started', 'البدء', 'Getting Started', 10),
  ('booking',         'الحجز', 'Booking Sessions', 20),
  ('homework',        'الواجبات', 'Homework', 30),
  ('packages',        'الباقات', 'Packages & Billing', 40),
  ('account',         'الحساب', 'Account', 50),
  ('troubleshooting', 'حل المشكلات', 'Troubleshooting', 60)
on conflict (slug) do nothing;

-- Feature flag default
insert into public.platform_settings (key, value, description)
select 'help_center_enabled', 'true', 'Enables /help and /admin/help'
where not exists (
  select 1 from public.platform_settings where key = 'help_center_enabled'
);

comment on table public.help_articles is
  'In-app knowledge base articles. Authored at /admin/help, served publicly at /help. RLS gates reads to is_published=true rows for non-admins.';
