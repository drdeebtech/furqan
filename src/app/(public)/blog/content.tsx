"use client";

import { useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { RegisterBanner } from "@/components/public/register-banner";

interface Post {
  slug: string;
  title_ar: string;
  title_en: string;
  excerpt_ar: string;
  excerpt_en: string;
  category_ar: string;
  category_en: string;
  color: string;
  read_time_ar: string;
  read_time_en: string;
  published_at: string;
}

const CATEGORIES = [
  { key: "all", ar: "الكل", en: "All" },
  { key: "Hifz", ar: "حفظ القرآن", en: "Hifz" },
  { key: "Tajweed", ar: "تجويد", en: "Tajweed" },
  { key: "Tips", ar: "نصائح", en: "Tips" },
  { key: "Children", ar: "للأطفال", en: "Children" },
  { key: "Qiraat", ar: "القراءات", en: "Qira'at" },
];

export function BlogContent({ posts }: { posts: Post[] }) {
  const { t } = useLang();
  const [filter, setFilter] = useState("all");
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const featured = posts[0];
  const rest = posts.slice(1);
  const filtered = filter === "all" ? rest : rest.filter((p) => p.category_en === filter);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return t(
      d.toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" }),
      d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
    );
  };

  return (
    <div>
      {/* Header */}
      <section className="glass-card border-b border-white/10 py-20 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("المدونة", "Blog")}
        </p>
        <h1 className="font-display mt-4 text-5xl font-bold">{t("المدونة", "Blog")}</h1>
        <p className="mt-3 text-sm text-muted">
          {t(`${posts.length} مقالة`, `${posts.length} Articles`)}
        </p>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          {/* Featured */}
          {featured && (
            <Link href={`/blog/${featured.slug}`} className="block glass-card p-8 transition-all hover:border-gold/50 md:p-12">
              <span className={`glass-badge inline-block px-3 py-1 text-xs ${featured.color}`}>
                {t(featured.category_ar, featured.category_en)}
              </span>
              <h2 className="font-display mt-4 text-3xl font-bold">{t(featured.title_ar, featured.title_en)}</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted">{t(featured.excerpt_ar, featured.excerpt_en)}</p>
              <div className="mt-4 flex items-center gap-4 text-xs text-muted">
                <span>{formatDate(featured.published_at)}</span>
                <span>{t(featured.read_time_ar, featured.read_time_en)} {t("للقراءة", "read")}</span>
              </div>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-gold transition-colors hover:text-gold-light">
                {t("اقرأ المزيد", "Read More")} <span aria-hidden>←</span>
              </span>
            </Link>
          )}

          {/* Filter tabs */}
          <div className="mb-8 mt-12 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={`rounded-full px-4 py-1.5 text-sm transition-all ${
                  filter === c.key
                    ? "glass-gold glass-pill font-medium"
                    : "glass glass-pill text-muted hover:border-gold/40 hover:text-foreground"
                }`}
              >
                {t(c.ar, c.en)}
              </button>
            ))}
          </div>

          {/* Grid */}
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">{t("لا توجد مقالات في هذا التصنيف", "No articles in this category")}</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a) => (
                <Link
                  key={a.slug}
                  href={`/blog/${a.slug}`}
                  className="block glass-card p-5 transition-all hover:border-gold/30 hover:shadow-sm"
                >
                  <span className={`glass-badge inline-block px-2.5 py-0.5 text-xs ${a.color}`}>
                    {t(a.category_ar, a.category_en)}
                  </span>
                  <h3 className="mt-3 font-bold">{t(a.title_ar, a.title_en)}</h3>
                  <p className="mt-2 line-clamp-2 text-sm text-muted">{t(a.excerpt_ar, a.excerpt_en)}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted">
                    <span>{formatDate(a.published_at)} · {t(a.read_time_ar, a.read_time_en)}</span>
                    <span className="text-gold">{t("اقرأ المزيد →", "Read More →")}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Newsletter */}
      <section className="border-t border-white/10 bg-card/30 py-16">
        <div className="mx-auto max-w-lg px-6 text-center">
          <h2 className="font-display text-2xl font-bold">{t("اشترك في نشرتنا البريدية", "Subscribe to Our Newsletter")}</h2>
          <p className="mt-2 text-sm text-muted">{t("نصائح أسبوعية لتعلم القرآن", "Weekly Quran learning tips in your inbox")}</p>

          {subscribed ? (
            <div className="mt-6 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-center text-sm text-green-400">
              {t("شكراً! تم تسجيلك بنجاح 🤍", "Thank you! You're subscribed 🤍")}
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (email) { setSubscribed(true); setEmail(""); } }} className="mt-6 flex gap-2">
              <input
                id="subscribe_email"
                name="subscribe_email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("بريدك الإلكتروني", "Your email")}
                dir="ltr"
                className="glass-input flex-1 rounded-xl px-4 py-2.5 text-left text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none"
              />
              <button type="submit" className="glass-gold glass-pill px-5 py-2.5 text-sm font-medium transition-colors hover:bg-gold-hover">
                {t("اشترك", "Subscribe")}
              </button>
            </form>
          )}
          <p className="mt-3 text-xs text-muted">{t("لن نشارك بريدك مع أحد", "We never share your email")}</p>
        </div>
      </section>

      <RegisterBanner />
    </div>
  );
}
