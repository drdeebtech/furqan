import { NextResponse, type NextRequest } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { parseAuditFilters, AUDIT_ACTION_MAP } from "@/lib/admin/audit-filters";
import { logError } from "@/lib/logger";

// Hard ceiling on a single export. Past this we tell the operator (never a
// silent truncation) to narrow the filters. ponytail: bump or stream if real
// exports routinely exceed this.
const EXPORT_CAP = 10000;

const HEADER = [
  "created_at", "changed_by", "actor_name", "table_name",
  "record_id", "action", "reason", "ip_address",
];

function csvCell(value: string | null): string {
  let s = value ?? "";
  // CSV formula injection: a cell starting with = + - @ (or tab/CR) executes as
  // a formula in Excel/Sheets. actor_name and reason are user-controlled, so
  // neutralize by prefixing a single quote before quoting.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface AuditRow {
  id: string;
  changed_by: string | null;
  table_name: string;
  record_id: string;
  action: string;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
}

/**
 * GET /admin/audit/export — CSV of audit_log under the current filters.
 * Route handlers are NOT wrapped by the admin layout's requireAdmin, so the
 * gate is enforced here explicitly.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const f = parseAuditFilters(sp);

  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("id, changed_by, table_name, record_id, action, reason, ip_address, created_at")
    .order("created_at", { ascending: false });

  const actions = AUDIT_ACTION_MAP[f.action];
  if (actions) query = query.in("action", actions);
  if (f.action === "failures") query = query.ilike("reason", "%FAILED%");
  if (f.table) query = query.eq("table_name", f.table);
  if (f.actor) query = query.eq("changed_by", f.actor);
  if (f.fromIso) query = query.gte("created_at", f.fromIso);
  if (f.toIso) query = query.lte("created_at", f.toIso);

  // Fetch one sentinel row past the cap so we can tell "exactly CAP rows" from
  // "more than CAP rows" — only the latter is a real truncation.
  query = query.limit(EXPORT_CAP + 1);
  const { data, error } = await query.returns<AuditRow[]>();
  if (error) {
    logError("admin audit CSV export failed", error, {
      tag: "data-load", severity: "warning", route: "admin-audit-export",
    });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }

  const fetched = data ?? [];
  const truncated = fetched.length > EXPORT_CAP;
  const rows = truncated ? fetched.slice(0, EXPORT_CAP) : fetched;
  const nameMap = await buildNameMap(
    supabase,
    [...new Set(rows.map((r) => r.changed_by).filter(Boolean) as string[])],
  );

  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push([
      r.created_at,
      r.changed_by ?? "",
      r.changed_by ? nameMap[r.changed_by] ?? "" : "System",
      r.table_name,
      r.record_id,
      r.action,
      r.reason,
      r.ip_address,
    ].map(csvCell).join(","));
  }
  if (truncated) {
    // Visible, never silent — the operator sees this row in any CSV reader.
    lines.push(csvCell(`# truncated at ${EXPORT_CAP} rows — narrow the date range or filters for the full set`));
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
