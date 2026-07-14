-- 20260722000001_role_statement_timeout.sql
--
-- Defense-in-depth query DoS ceiling for untrusted roles. Service/postgres roles
-- are intentionally untouched.

alter role authenticated set statement_timeout = '15s';
alter role anon set statement_timeout = '10s';
