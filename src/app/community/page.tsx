import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, MessageSquare, Pin, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";
import { buildNameMap } from "@/lib/admin/name-map";

export const metadata: Metadata = { title: "المجتمع" };

export default async function CommunityIndexPage() {
  if (!(await isFeatureEnabled("community_enabled"))) notFound();

  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const { data: threads } = await supabase.from("forum_threads")
    .select("id, author_id, title_ar, title_en, category, is_pinned, is_locked, reply_count, last_reply_at, created_at")
    .eq("is_hidden", false)
    .order("is_pinned", { ascending: false })
    .order("last_reply_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<{
      id: string; author_id: string;
      title_ar: string; title_en: string | null;
      category: string;
      is_pinned: boolean; is_locked: boolean;
      reply_count: number;
      last_reply_at: string | null; created_at: string;
    }[]>();

  const list = threads ?? [];
  const nameMap = await buildNameMap(supabase, list.map((th) => th.author_id));

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            {t("المجتمع", "Community")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("شاركنا تجربتك مع القرآن الكريم.",
               "Share your Quran journey with the community.")}
          </p>
        </div>
        <Link
          href="/community/new"
          className="glass-gold glass-pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <Plus size={14} aria-hidden="true" /> {t("موضوع جديد", "New thread")}
        </Link>
      </header>

      {list.length === 0 ? (
        <div className="glass-card flex flex-col items-center px-6 py-12 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
            <MessageSquare size={22} className="text-gold" aria-hidden="true" />
          </div>
          <p className="font-display text-lg font-semibold text-foreground">
            {t("ابدأ المحادثة الأولى",
               "Start the first conversation")}
          </p>
          <p className="mt-2 max-w-sm text-sm text-muted">
            {t("شارك سؤالاً، تجربة، أو سيرة آية أثّرت فيك. الأخوّة هنا تبدأ بكلمة.",
               "Ask a question, share an experience, or reflect on an ayah. Brotherhood begins with a single thread.")}
          </p>
          <Link
            href="/community/new"
            className="glass-gold glass-pill mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold"
          >
            <Plus size={14} aria-hidden="true" />
            {t("اكتب أول موضوع", "Post the first thread")}
          </Link>
        </div>
      ) : (
        <ul className="glass-card divide-y divide-[var(--surface-divider,#F0F0F2)] overflow-hidden">
          {list.map((th) => (
            <li key={th.id}>
              <Link
                href={`/community/${th.id}`}
                className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-foreground/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {th.is_pinned && <Pin size={12} className="text-gold" aria-hidden="true" />}
                    {th.is_locked && <Lock size={12} className="text-muted" aria-hidden="true" />}
                    <p className="truncate text-sm font-semibold">
                      {lang === "ar" ? th.title_ar : (th.title_en ?? th.title_ar)}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {nameMap[th.author_id] ?? "—"} · {th.category} · {new Date(th.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <MessageSquare size={12} aria-hidden="true" />
                  {th.reply_count}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
