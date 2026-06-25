create table ai_output_review (
  id uuid primary key default gen_random_uuid(),
  workflow_name text not null,
  entity_type text not null,
  entity_id uuid not null,
  output_text text not null,
  output_json jsonb,
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  auto_send_eligible boolean not null default false,
  created_at timestamptz not null default now()
);

alter table ai_output_review enable row level security;

create policy "Admins manage ai_output_review"
  on ai_output_review for all
  using (is_admin())
  with check (is_admin());

create index idx_aior_pending on ai_output_review (workflow_name, created_at)
  where status = 'pending_review';

comment on table ai_output_review is
  'Holds AI-generated outputs pending admin approval before delivery to end users.';
