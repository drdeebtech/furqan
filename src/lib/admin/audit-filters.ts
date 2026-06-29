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

/**
 * Parse loose search params into a validated filter set. Anything malformed
 * is dropped (fail-safe to "no filter") rather than throwing.
 */
export function parseAuditFilters(
  sp: Record<string, string | undefined>,
): AuditFilters {
  const action: AuditActionFilter =
    sp.type === "mutations" || sp.type === "auth" || sp.type === "failures"
      ? sp.type
      : "all";

  const table = sp.table?.trim() || undefined;
  const actor = sp.actor?.trim() || undefined;

  const fromDate = sp.from && DATE_RE.test(sp.from) ? sp.from : undefined;
  const toDate = sp.to && DATE_RE.test(sp.to) ? sp.to : undefined;

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
