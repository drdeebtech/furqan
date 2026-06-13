-- cosmetic defense-in-depth (spec 012); quiz_question_keys is already RLS-protected by quiz_question_keys_owner_select/owner_write, this removes a needless anon grant
revoke all on table public.quiz_question_keys from anon;
