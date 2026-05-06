import type { Metadata } from "next";
import { ApplyForm } from "./apply-form";
import { getAllTeacherPicklists } from "@/lib/site-content/queries";

export const metadata: Metadata = {
  title: "تقديم طلب تدريس | Apply to teach — FURQAN",
  description:
    "املأ نموذج التقديم للانضمام إلى هيئة التدريس في أكاديمية فُرقان.",
  alternates: { canonical: "https://www.furqan.today/teach-with-us/apply" },
};

export default async function ApplyPage() {
  const picklists = await getAllTeacherPicklists();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <ApplyForm picklists={picklists} />
    </main>
  );
}
