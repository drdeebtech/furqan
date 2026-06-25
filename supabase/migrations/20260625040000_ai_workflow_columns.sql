-- Add columns needed by the 6 AI/LLM n8n workflows (spec 028).
-- All additions are idempotent (IF NOT EXISTS).

alter table retention_signals
  add column if not exists weakness_json jsonb,
  add column if not exists risk_reason text,
  add column if not exists intervention_suggestion text;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'student_profiles') then
    alter table student_profiles add column if not exists recommended_teacher_ids uuid[];
  end if;
end $$;
