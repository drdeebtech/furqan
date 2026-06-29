import type { Metadata } from "next";
import Link from "next/link";
import { Shield, Inbox, Download, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { getT } from "@/lib/i18n/server";
import { EmptyState } from "@/components/shared/empty-state";
import { logError } from "@/lib/logger";
import {
  parseAuditFilters,
  hasActiveAuditFilters,
  AUDIT_ACTION_MAP,
  type AuditActionFilter,
} from "@/lib/admin/audit-filters";

export const metadata: Metadata = { title: "سجل المراجعة" };

interface AuditRow { id: string; changed_by: string | null; table_name: string; record_id: string; action: string; reason: string | null; ip_address: string | null; created_at: string; }

const PAGE_SIZE = 50;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, dir, lang } = await getT();
  const sp = await searchParams;
  const f = parseAuditFilters(sp);

  const pageRaw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = Math.max(1, Number(pageRaw) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  let query = supabase.from("audit_log")
    .select("id, changed_by, table_name, record_id, action, reason, ip_address, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE);

  const actions = AUDIT_ACTION_MAP[f.action];
  if (actions) query = query.in("action", actions);
  if (f.action === "failures") query = query.ilike("reason", "%FAILED%");
  if (f.table) query = query.eq("table_name", f.table);
  if (f.actor) query = query.eq("changed_by", f.actor);
  if (f.fromIso) query = query.gte("created_at", f.fromIso);
  if (f.toIso) query = query.lte("created_at", f.toIso);

  const { data, error } = await query.returns<AuditRow[]>();
  const loadFailed = !!error;
  if (error) logError("admin audit log load failed", error, { route: "admin-audit", severity: "warning" });
  const hasNextPage = (data?.length ?? 0) > PAGE_SIZE;
  const logs = (data ?? []).slice(0, PAGE_SIZE);

  // Include the actor filter id so its name renders in the active-filter chip.
  const idsToName = new Set(logs.map(l => l.changed_by).filter(Boolean) as string[]);
  if (f.actor) idsToName.add(f.actor);
  const nameMap = await buildNameMap(supabase, [...idsToName]);

  const actionColor: Record<string, string> = {
    INSERT: "text-success",
    UPDATE: "text-warning",
    DELETE: "text-red-400",
    LOGIN: "text-gold",
    LOGOUT: "text-slate-400",
  };

  const filterTabs: { value: AuditActionFilter; label: string }[] = [
    { value: "all", label: t("الكل", "All") },
    { value: "mutations", label: t("التغييرات", "Mutations") },
    { value: "auth", label: t("الدخول والخروج", "Auth events") },
    { value: "failures", label: t("الإجراءات الفاشلة", "Failures") },
  ];

  // Build a querystring carrying the current filters. Any key in `over`
  // (type/actor/page) overrides the current value; pass "" to clear one.
  const qs = (over: { type?: string; actor?: string; page?: string } = {}): string => {
    const params: Record<string, string> = {};
    const type = "type" in over ? over.type : (f.action !== "all" ? f.action : undefined);
    const actor = "actor" in over ? over.actor : f.actor;
    if (type) params.type = type;
    if (actor) params.actor = actor;
    if (f.table) params.table = f.table;
    if (f.fromDate) params.from = f.fromDate;
    if (f.toDate) params.to = f.toDate;
    if (over.page) params.page = over.page;
    const s = new URLSearchParams(params).toString();
    return s ? `?${s}` : "";
  };

  const active = hasActiveAuditFilters(f);

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Shield size={24} className="text-gold" /> {t("سجل المراجعة", "Audit Log")}
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-[var(--surface-border)] bg-surface p-1 text-xs">
            {filterTabs.map((tab) => (
              <Link
                key={tab.value}
                href={`/admin/audit${qs({ type: tab.value === "all" ? undefined : tab.value })}`}
                aria-current={f.action === tab.value ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  f.action === tab.value ? "bg-gold/20 text-gold" : "text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <a
            href={`/admin/audit/export${qs()}`}
            className="flex items-center gap-1 rounded-lg border border-[var(--surface-border)] bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
          >
            <Download size={14} /> {t("تصدير CSV", "Export CSV")}
          </a>
        </div>
      </div>

      {/* Table + date-range filter form (GET → searchParams). Action stays on the tabs. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl glass-card p-3 text-xs">
        {f.action !== "all" && <input type="hidden" name="type" value={f.action} />}
        {f.actor && <input type="hidden" name="actor" value={f.actor} />}
        <label className="flex flex-col gap-1">
          <span className="text-muted">{t("الجدول", "Table")}</span>
          <input name="table" defaultValue={f.table ?? ""} placeholder="bookings" dir="ltr"
            className="rounded-lg border border-[var(--surface-border)] bg-surface px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">{t("من", "From")}</span>
          <input type="date" name="from" defaultValue={f.fromDate ?? ""}
            className="rounded-lg border border-[var(--surface-border)] bg-surface px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">{t("إلى", "To")}</span>
          <input type="date" name="to" defaultValue={f.toDate ?? ""}
            className="rounded-lg border border-[var(--surface-border)] bg-surface px-2 py-1.5" />
        </label>
        <button type="submit" className="rounded-lg bg-gold/20 px-3 py-1.5 text-gold transition-colors hover:bg-gold/30">
          {t("تطبيق", "Apply")}
        </button>
        {active && (
          <Link href="/admin/audit" className="flex items-center gap-1 px-2 py-1.5 text-muted hover:text-foreground">
            <X size={14} /> {t("مسح", "Clear")}
          </Link>
        )}
      </form>

      {f.actor && (
        <p className="mb-3 text-xs text-muted">
          {t("مُرشَّح حسب المستخدم:", "Filtered by user:")}{" "}
          <span className="text-foreground">{nameMap[f.actor] ?? f.actor}</span>
        </p>
      )}

      {loadFailed ? (
        <div role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t("تعذّر تحميل السجلات. تحقّق من المرشّحات أو حاول لاحقًا.", "Failed to load records. Check the filters or try again later.")}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" aria-hidden="true" />}
          message={t("لا توجد سجلات", "No records")}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="glass-thead">
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المستخدم", "User")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الجدول", "Table")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الإجراء", "Action")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("السبب", "Reason")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">IP</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("التاريخ", "Date")}</th>
            </tr></thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3">
                    {l.changed_by ? (
                      <Link href={`/admin/audit${qs({ actor: l.changed_by })}`} className="text-fg hover:underline">
                        {nameMap[l.changed_by] ?? "—"}
                      </Link>
                    ) : t("نظام", "System")}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted" dir="ltr">{l.table_name}</td>
                  <td className="px-3 py-3"><span className={`text-xs font-medium ${actionColor[l.action] ?? "text-muted"}`}>{l.action}</span></td>
                  <td className="px-3 py-3 text-xs text-muted">{l.reason ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted" dir="ltr">{l.ip_address ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted">{new Date(l.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", { timeZone: "UTC" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(logs.length > 0 || page > 1) && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="audit pagination">
          {page > 1 ? (
            <Link href={`/admin/audit${qs({ page: String(page - 1) })}`} className="text-fg hover:underline">
              ← {t("السابق", "Previous")}
            </Link>
          ) : <span className="text-muted opacity-40">← {t("السابق", "Previous")}</span>}
          <span className="text-xs text-muted">{t(`صفحة ${page}`, `Page ${page}`)}</span>
          {hasNextPage ? (
            <Link href={`/admin/audit${qs({ page: String(page + 1) })}`} className="text-fg hover:underline">
              {t("التالي", "Next")} →
            </Link>
          ) : <span className="text-muted opacity-40">{t("التالي", "Next")} →</span>}
        </nav>
      )}
    </div>
  );
}
