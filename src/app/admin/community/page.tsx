import type { Metadata } from "next";
import Link from "next/link";
import { Pin, Lock, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { ModerationControls } from "./moderation-controls";

export const metadata: Metadata = { title: "إدارة المجتمع" };

export default async function AdminCommunityPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const [threadsRes, reportsRes] = await Promise.all([
    supabase.from("forum_threads")
      .select("id, author_id, title_ar, title_en, is_pinned, is_locked, is_hidden, reply_count, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<{ id: string; author_id: string; title_ar: string; title_en: string | null; is_pinned: boolean; is_locked: boolean; is_hidden: boolean; reply_count: number; created_at: string }[]>(),
    supabase.from("forum_reports")
      .select("id, reporter_id, target_type, target_id, reason, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .returns<{ id: string; reporter_id: string; target_type: string; target_id: string; reason: string | null; status: string; created_at: string }[]>(),
  ]);

  const threads = threadsRes.data ?? [];
  const reports = reportsRes.data ?? [];
  const allUserIds = [
    ...threads.map((t) => t.author_id),
    ...reports.map((r) => r.reporter_id),
  ];
  const nameMap = await buildNameMap(supabase, allUserIds);

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-display text-xl font-bold sm:text-2xl">
        {t("إدارة المجتمع", "Community Moderation")}
      </h1>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-light">
          <AlertTriangle size={12} className="me-1 inline text-warning" aria-hidden="true" />
          {t("بلاغات بانتظار المراجعة", "Pending reports")} ({reports.length})
        </h2>
        {reports.length === 0 ? (
          <p className="text-sm text-muted">{t("لا بلاغات", "No reports")}</p>
        ) : (
          <ul className="glass-card divide-y divide-[var(--surface-divider,#F0F0F2)] overflow-hidden">
            {reports.map((r) => (
              <li key={r.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-xs text-muted-light">
                      {r.target_type === "thread" ? t("موضوع", "Thread") : t("رد", "Reply")} ·{" "}
                      {nameMap[r.reporter_id] ?? "—"} · {new Date(r.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}
                    </p>
                    <p className="mt-1 text-sm">{r.reason}</p>
                  </div>
                  <ModerationControls
                    kind="report"
                    targetId={r.id}
                    extraTargetType={r.target_type as "thread" | "reply"}
                    extraTargetId={r.target_id}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-light">
          {t("جميع المواضيع", "All threads")} ({threads.length})
        </h2>
        {threads.length === 0 ? (
          <p className="text-sm text-muted">{t("لا مواضيع", "No threads")}</p>
        ) : (
          <ul className="glass-card divide-y divide-[var(--surface-divider,#F0F0F2)] overflow-hidden">
            {threads.map((th) => (
              <li key={th.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/community/${th.id}`} className="flex items-center gap-1.5 text-sm font-medium hover:text-gold">
                    {th.is_pinned && <Pin size={11} className="text-gold" aria-hidden="true" />}
                    {th.is_locked && <Lock size={11} aria-hidden="true" />}
                    {th.is_hidden ? <EyeOff size={11} className="text-error" aria-hidden="true" /> : <Eye size={11} aria-hidden="true" />}
                    <span className="truncate">{lang === "ar" ? th.title_ar : (th.title_en ?? th.title_ar)}</span>
                  </Link>
                  <p className="text-[11px] text-muted">
                    {nameMap[th.author_id] ?? "—"} · {th.reply_count} {t("ردود", "replies")} · {new Date(th.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")}
                  </p>
                </div>
                <ModerationControls
                  kind="thread"
                  targetId={th.id}
                  initial={{ is_pinned: th.is_pinned, is_locked: th.is_locked, is_hidden: th.is_hidden }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
