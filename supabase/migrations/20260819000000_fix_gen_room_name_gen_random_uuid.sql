-- Fix #708: gen_room_name() fallback raised "function uuid_generate_v4() does not exist".
--
-- The BEFORE INSERT trigger on public.sessions builds a fallback room_name when the
-- caller omits one. It pinned SET search_path=public, but uuid_generate_v4() lives in
-- the `extensions` schema, so the fallback branch raised and the INSERT failed. Live
-- callers always supply room_name (the Daily.co room), so it was dead-path today — but
-- any insert that omits room_name (backfill, admin tool, test fixture, new session type,
-- direct SQL seeding) hit a confusing DB error.
--
-- Fix: use gen_random_uuid() (pg core, in pg_catalog — no extension, no search_path
-- coupling), matching what newer tables in this repo already default to. Everything else
-- (signature, language, search_path pin, body logic) is unchanged. CREATE OR REPLACE is
-- backward-compatible: the trigger binding and grants are untouched.

CREATE OR REPLACE FUNCTION "public"."gen_room_name"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.room_name IS NULL OR NEW.room_name = '' THEN
    NEW.room_name := 'furqan-' || REPLACE(gen_random_uuid()::text, '-', '');
  END IF;
  RETURN NEW;
END;
$$;
