import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Pin, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";
import { buildNameMap } from "@/lib/admin/name-map";
import { createReply } from "@/lib/actions/community";
import { getDashboardHref } from "@/lib/auth/dashboard-href";

export const metadata: Metadata = { title: "موضوع المجتمع" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ThreadPage({ params }: Props) {
  if (!(await isFeatureEnabled("community_enabled"))) notFound();

  const { id } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const [threadRes, repliesRes] = await Promise.all([
    supabase.from("forum_threads")
      .select("id, author_id, title_ar, title_en, body_ar, body_en, category, is_pinned, is_locked, is_hidden, created_at")
      .eq("id", id)
      .single<{
        id: string; author_id: string;
        title_ar: string; title_en: string | null;
        body_ar: string; body_en: string | null;
        category: string;
        is_pinned: boolean; is_locked: boolean; is_hidden: boolean;
        created_at: string;
      }>(),
    supabase.from("forum_replies")
      .select("id, author_id, body_ar, body_en, is_hidden, created_at")
      .eq("thread_id", id)
      .eq("is_hidden", false)
      .order("created_at", { ascending: true })
      .returns<{ id: string; author_id: string; body_ar: string; body_en: string | null; is_hidden: boolean; created_at: string }[]>(),
  ]);

  if (!threadRes.data || threadRes.data.is_hidden) notFound();
  const thread = threadRes.data;
  const replies = repliesRes.data ?? [];

  const allAuthorIds = [thread.author_id, ...replies.map((r) => r.author_id)];
  const nameMap = await buildNameMap(supabase, allAuthorIds);

  async function reply(formData: FormData) {
    "use server";
    const res = await createReply(id, formData);
    if (!res.ok) {
      // Fail silently here; in a richer flow we'd redirect back with a toast.
    }
    redirect(`/community/${id}`);
  }

  const Arrow = dir === "rtl" ? ArrowRight : ArrowLeft;
  const title = lang === "ar" ? thread.title_ar : (thread.title_en ?? thread.title_ar);
  const body = lang === "ar" ? thread.body_ar : (thread.body_en ?? thread.body_ar);
  const dashboardHref = await getDashboardHref(supabase);

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {dashboardHref && (
        <div className="mb-6 flex items-center justify-between gap-3 border-b border-card-border/60 pb-4 text-sm">
          <span className="text-muted">
            {t("المجتمع — يمكنك العودة إلى لوحة التحكم في أي وقت.",
               "Community — return to your dashboard anytime.")}
          </span>
          <Link href={dashboardHref} className="shrink-0 font-medium text-gold hover:text-gold-hover focus-ring rounded">
            {t("العودة للوحة التحكم", "Back to dashboard")}
          </Link>
        </div>
      )}
      <Link href="/community" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <Arrow size={14} aria-hidden="true" />
        {t("العودة للمجتمع", "Back to Community")}
      </Link>

      <article className="glass-card mb-6 p-6 sm:p-8">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
          {thread.is_pinned && <Pin size={11} className="text-gold" aria-hidden="true" />}
          {thread.is_locked && <Lock size={11} aria-hidden="true" />}
          <span>{thread.category}</span>
        </div>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-xs text-muted">
          {nameMap[thread.author_id] ?? "—"} · {new Date(thread.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US")}
        </p>
        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{body}</div>
      </article>

      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">
          {t("الردود", "Replies")} ({replies.length})
        </h2>
        {replies.length === 0 ? (
          <p className="text-sm text-muted">{t("لا ردود بعد", "No replies yet")}</p>
        ) : (
          <ul className="space-y-3">
            {replies.map((r) => (
              <li key={r.id} className="glass-card p-4">
                <p className="text-xs text-muted">
                  {nameMap[r.author_id] ?? "—"} · {new Date(r.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US")}
                </p>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  {lang === "ar" ? r.body_ar : (r.body_en ?? r.body_ar)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!thread.is_locked ? (
        <form action={reply} className="glass-card space-y-3 p-4">
          <textarea
            required
            name="body_ar"
            rows={4}
            placeholder={t("اكتب ردك...", "Write your reply...")}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm leading-relaxed"
          />
          <button type="submit" className="glass-gold glass-pill px-5 py-2 text-sm font-semibold">
            {t("نشر الرد", "Post reply")}
          </button>
        </form>
      ) : (
        <p className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-light)] p-3 text-sm text-muted">
          🔒 {t("هذا الموضوع مغلق ولا يمكن الرد عليه.", "This thread is locked.")}
        </p>
      )}
    </div>
  );
}
