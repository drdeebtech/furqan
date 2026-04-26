import type { Metadata } from "next";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = {
  title: "تقديم طلب تدريس | Apply to teach — FURQAN",
  description:
    "املأ نموذج التقديم للانضمام إلى هيئة التدريس في أكاديمية فُرقان.",
  alternates: { canonical: "https://furqan.today/teach/apply" },
};

export default function ApplyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <ApplyForm />
    </main>
  );
}
