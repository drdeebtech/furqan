/**
 * Teacher-roster-scoped Supabase queries.
 *
 * Sibling to `dashboard-queries.ts` (which is page-level). This module is the
 * single source of truth for queries scoped to a teacher's roster — talqeen
 * inbox, recitation tracker, calendar events, package balances, teaching
 * hours, and roster progress aggregations.
 *
 * Every function here filters by `teacher_id = auth.uid()` (or equivalent
 * ownership) at the SQL level, so RLS plus the explicit filter give
 * defense-in-depth. Pages must never bypass this module by writing inline
 * Supabase calls — that pattern caused the duplicated-query problem in the
 * student dashboard before the existing dashboard-queries.ts consolidation.
 *
 * Functions are added incrementally per PR. Each new function lands alongside
 * its consuming page in the same PR, never as speculative scaffolding.
 */

export type TeacherId = string;
