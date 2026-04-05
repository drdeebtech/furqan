import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardCheck, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EvaluationForm } from "./evaluation-form";

export const metadata: Metadata = { title: "إنشاء تقييم جديد" };

interface ProfileOption {
  id: string;
  full_name: string | null;
  role: string;
}

export default async function NewEvaluationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch students and teachers in parallel
  const [studentsRes, teachersRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("role", "student")
      .order("full_name")
      .returns<ProfileOption[]>(),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("role", "teacher")
      .order("full_name")
      .returns<ProfileOption[]>(),
  ]);

  const students = (studentsRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name ?? "طالب",
  }));

  const teachers = (teachersRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name ?? "معلم",
  }));

  return (
    <div dir="rtl" className="mx-auto max-w-3xl px-4 py-8">
      {/* Back link */}
      <Link
        href="/admin/evaluations"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowRight size={14} />
        العودة للتقييمات
      </Link>

      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <ClipboardCheck size={24} className="text-gold" />
        إنشاء تقييم جديد
      </h1>

      <div className="rounded-2xl border border-card-border bg-card p-6">
        <EvaluationForm students={students} teachers={teachers} />
      </div>
    </div>
  );
}
