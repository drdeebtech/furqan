import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { NewOfferingForm } from "./new-offering-form";

export const metadata: Metadata = { title: "إنشاء جلسة جماعية" };

export default async function NewClassOfferingPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div dir={dir} className="mx-auto max-w-xl px-4 py-8">
      <Link
        href="/teacher/classes"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover"
      >
        <ArrowRight size={14} />
        {t("العودة للجلسات الجماعية", "Back to Group Classes")}
      </Link>
      <h1 className="mb-2 text-2xl font-bold">
        {t("إنشاء جلسة جماعية", "Create a group class")}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {t(
          "حدِّد التفاصيل وسيتمكن الطلاب من التسجيل عند نشر الإعلان.",
          "Set the details — students can self-enroll once you publish.",
        )}
      </p>
      <NewOfferingForm />
    </div>
  );
}
