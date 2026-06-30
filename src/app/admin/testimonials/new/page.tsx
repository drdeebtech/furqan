import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { TestimonialForm } from "../testimonial-form";

export const metadata: Metadata = { title: "شهادة جديدة · New Testimonial" };

export default async function NewTestimonialPage() {
  const { t, dir } = await getT();

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <Link
          href="/admin/testimonials"
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-gold"
        >
          <ArrowRight size={12} className="rotate-180" /> {t("العودة للقائمة", "Back to List")}
        </Link>
        <h1 className="mt-3 text-xl font-bold">{t("شهادة جديدة", "New Testimonial")}</h1>
      </header>
      <TestimonialForm mode="create" />
    </div>
  );
}
