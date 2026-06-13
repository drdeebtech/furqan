-- Stage 7 (deferred path) / Track A — External lecture URL
--
-- The migration plan's Stage 7 is a full broadcast-mode build (lecture
-- mode with owner_only_broadcast Daily rooms, large-event UI, ticketed
-- registration). It's gated on a decision: "if at least 2 teachers have
-- asked AND at least 10 paying students have asked AND it's on the
-- critical path for revenue — proceed; else SKIP and ship a YouTube Live
-- integration instead."
--
-- We're on the SKIP path. This migration ships the deferred-path
-- minimum: a single optional URL column on sessions so a teacher running
-- a one-to-many session on YouTube Live (or any external broadcast
-- platform) can attach the link to their FURQAN session record. The UI
-- side — render the link as a "Watch live →" button on the session
-- detail page — lands in a follow-up PR alongside the click handler.
--
-- ZERO behavior change today. Empty column, no defaults, no constraints
-- beyond a sanity-check max length.

alter table sessions
  add column if not exists external_lecture_url text
    check (external_lecture_url is null or length(external_lecture_url) <= 2048);

comment on column sessions.external_lecture_url is
  'Optional external broadcast URL (typically YouTube Live, but any platform). Set when a session is being delivered via an external broadcast rather than via Daily.co. If non-null, the session detail page surfaces a "Watch live" link instead of the in-app video player. Stage 7 deferred path per FURQAN_SESSION_MODES_MIGRATION_PLAN.md.';
