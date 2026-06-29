/**
 * Shared parsing for the `/admin/audit` filters, used by both the page
 * (src/app/admin/audit/page.tsx) and the CSV export route handler
 * (src/app/admin/audit/export/route.ts) so the two never drift.
 *
 * The `audit_log` table is a row-change log (spec 034 D2): filterable by
 * actor (`changed_by`), `table_name`, `action`, and a `created_at` range —
 * NOT by named business action (that name is only in Sentry, not the row).
 */

export type AuditActionFilter = "all" | "mutations" | "auth" | "failures";

/** Which `action` values each tab maps to. `failures` filters by reason, not action. */
export const AUDIT_ACTION_MAP: Record<AuditActionFilter, string[] | null> = {
  all: null,
  mutations: ["INSERT", "UPDATE", "DELETE"],
  auth: ["LOGIN", "LOGOUT"],
  failures: null,
};

export interface AuditFilters {
  action: AuditActionFilter;
  /** Exact `table_name` match, or undefined for any. */
  table?: string;
  /** Actor user id (`changed_by`), or undefined for any. */
  actor?: string;
  /** Inclusive `created_at` lower bound as ISO, or undefined. */
  fromIso?: string;
  /** Inclusive `created_at` upper bound as ISO, or undefined. */
  toIso?: string;
  /** The raw YYYY-MM-DD values, echoed back for pre-filling the form inputs. */
  fromDate?: string;
  toDate?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date — rejects e.g. 2026-02-31, 2026-13-01. */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Next.js searchParams give string[] for repeated keys — take the first. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Parse loose search params into a validated filter set. Anything malformed
 * (including impossible dates and repeated-key arrays) is dropped (fail-safe
 * to "no filter") rather than throwing.
 */
export function parseAuditFilters(
  sp: Record<string, string | string[] | undefined>,
): AuditFilters {
  const type = one(sp.type);
  const action: AuditActionFilter =
    type === "mutations" || type === "auth" || type === "failures" ? type : "all";

  const table = one(sp.table)?.trim() || undefined;
  const actor = one(sp.actor)?.trim() || undefined;

  const fromRaw = one(sp.from);
  const toRaw = one(sp.to);
  const fromDate = fromRaw && isRealDate(fromRaw) ? fromRaw : undefined;
  const toDate = toRaw && isRealDate(toRaw) ? toRaw : undefined;

  return {
    action,
    table,
    actor,
    fromDate,
    toDate,
    fromIso: fromDate ? `${fromDate}T00:00:00.000Z` : undefined,
    // inclusive end-of-day so a single from=to=day still selects that whole day
    toIso: toDate ? `${toDate}T23:59:59.999Z` : undefined,
  };
}

/** Are any non-default filters active? (drives the "clear" affordance). */
export function hasActiveAuditFilters(f: AuditFilters): boolean {
  return f.action !== "all" || !!f.table || !!f.actor || !!f.fromIso || !!f.toIso;
}
