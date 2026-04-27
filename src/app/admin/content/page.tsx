import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText, Layers, Tags } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { FaqEditor } from "./faq-editor";
import { FeatureEditor } from "./feature-editor";
import { CategoryEditor } from "./category-editor";
import type { SiteFaq, SiteFeature, SiteBlogCategory } from "@/lib/site-content/types";

export const metadata: Metadata = { title: "محتوى الموقع" };

const SLOTS = [
  { key: "home_how_it_works", labelAr: "كيف يعمل (الرئيسية)", labelEn: "How it works (home)" },
  { key: "home_why_us", labelAr: "لماذا فرقان (الرئيسية)", labelEn: "Why Furqan (home)" },
  { key: "home_subjects", labelAr: "ما نُعلّمه (الرئيسية)", labelEn: "What we teach (home)" },
  { key: "home_trust_strip", labelAr: "شريط الاعتمادات (الرئيسية)", labelEn: "Trust strip (home)" },
  { key: "home_package_preview", labelAr: "عرض الباقات (الرئيسية)", labelEn: "Package preview (home)" },
  { key: "about_values", labelAr: "قيمنا (من نحن)", labelEn: "Our values (about)" },
];

export default async function AdminContentPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Service-role would let us see inactive rows, but the regular client is
  // fine because is_admin() RLS allows admins to read everything anyway.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [faqsRes, featsRes, catsRes] = await Promise.all([
    sb.from("site_faqs").select("*").order("sort_order"),
    sb.from("site_features").select("*").order("slot").order("sort_order"),
    sb.from("site_blog_categories").select("*").order("sort_order"),
  ]);
  const faqs = (faqsRes.data ?? []) as SiteFaq[];
  const features = (featsRes.data ?? []) as SiteFeature[];
  const categories = (catsRes.data ?? []) as SiteBlogCategory[];

  return (
    <main dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 text-2xl font-bold">{t("محتوى الموقع", "Site Content")}</h1>
      <p className="mb-8 text-sm text-muted">
        {t(
          "حرر النصوص والميزات والتصنيفات الظاهرة في صفحات الموقع العامة.",
          "Edit copy, features, and categories shown on public site pages.",
        )}
      </p>

      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <FileText size={18} className="text-gold" aria-hidden="true" />
          {t("الأسئلة الشائعة", "FAQs")}
          <span className="text-xs font-normal text-muted">({faqs.length})</span>
        </h2>
        <FaqEditor faqs={faqs} />
      </section>

      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Layers size={18} className="text-gold" aria-hidden="true" />
          {t("الميزات والكتل", "Features & Blocks")}
          <span className="text-xs font-normal text-muted">({features.length})</span>
        </h2>
        {SLOTS.map((slot) => {
          const slotFeatures = features.filter((f) => f.slot === slot.key);
          return (
            <FeatureEditor
              key={slot.key}
              slotKey={slot.key}
              slotLabel={t(slot.labelAr, slot.labelEn)}
              features={slotFeatures}
            />
          );
        })}
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Tags size={18} className="text-gold" aria-hidden="true" />
          {t("تصنيفات المدونة", "Blog Categories")}
          <span className="text-xs font-normal text-muted">({categories.length})</span>
        </h2>
        <CategoryEditor categories={categories} />
      </section>
    </main>
  );
}
