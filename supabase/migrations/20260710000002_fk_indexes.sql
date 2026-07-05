-- FK-hygiene indexes flagged by the 2026-07-05 DB review: unindexed foreign keys
-- that back joins/lookups. Pure additive (expand/contract-safe).

create index if not exists idx_sta_subscription
  on subscription_teacher_assignments (subscription_id);

create index if not exists idx_subscriptions_plan_id
  on public.subscriptions (plan_id);

create index if not exists idx_subscriptions_payer_user_id
  on public.subscriptions (payer_user_id);

create index if not exists idx_testimonials_teacher_id
  on public.testimonials (teacher_id);
