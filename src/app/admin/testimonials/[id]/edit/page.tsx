import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Testimonial } from "@/types/database";
import { getT } from "@/lib/i18n/server";
import { TestimonialForm } from "../../testimonial-form";

export const metadata: Metadata = { title: "تعديل شهادة · Edit Testimonial" };

export default async function EditTestimonialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t, dir } = await getT();
  // admin: read a single testimonial (incl. unpublished) for editing.
  const supabase = createAdminClient();
  const { data: testimonial, error } = await supabase
    .from("testimonials")
    .select("id, author_name, author_location, quote_ar, quote_en, teacher_id, is_published, display_order, created_at")
    .eq("id", id)
    .maybeSingle<Testimonial>();

  if (error) throw error;
  if (!testimonial) notFound();

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <Link
          href="/admin/testimonials"
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-gold"
        >
          <ArrowRight size={12} className="rotate-180" /> {t("العودة للقائمة", "Back to List")}
        </Link>
        <h1 className="mt-3 text-xl font-bold">{t("تعديل شهادة", "Edit Testimonial")}</h1>
      </header>
      <TestimonialForm mode="edit" testimonial={testimonial} />
    </div>
  );
}
