-- T005: Seed AI feature flags into platform_settings (spec 028).
-- Idempotent — safe to re-run. All flags ship disabled ('false'); admin enables per-workflow.
-- Columns: key (text, unique), value (text). See 20260428000000_remote_baseline.sql.

insert into platform_settings (key, value)
values
  ('ai_weakness_detection_enabled', 'false'),
  ('ai_coaching_enabled',           'false'),
  ('ai_risk_classifier_enabled',    'false'),
  ('ai_parent_reports_enabled',     'false'),
  ('ai_curriculum_advisor_enabled', 'false'),
  ('ai_matching_advisor_enabled',   'false')
on conflict (key) do nothing;
