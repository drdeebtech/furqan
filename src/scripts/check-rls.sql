-- Run in Supabase SQL Editor to verify RLS is enabled on all tables.

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Expected: rowsecurity = true for all 20 tables
-- If any table shows false, enable it with:
--   ALTER TABLE <tablename> ENABLE ROW LEVEL SECURITY;
