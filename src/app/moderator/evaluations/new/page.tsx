import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EvaluationForm } from "./evaluation-form";

export const metadata: Metadata = { title: "تقييم جديد" };

export default async function ModeratorNewEvaluationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [studentsRes, teachersRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("role", "student").eq("is_active", true)
      .returns<{ id: string; full_name: string | null }[]>(),
    supabase.from("profiles").select("id, full_name").eq("role", "teacher").eq("is_active", true)
      .returns<{ id: string; full_name: string | null }[]>(),
  ]);

  const students = (studentsRes.data ?? []).map(s => ({ id: s.id, name: s.full_name ?? "طالب" }));
  const teachers = (teachersRes.data ?? []).map(t => ({ id: t.id, name: t.full_name ?? "معلم" }));

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/moderator/evaluations" className="glass rounded-lg p-2 text-muted transition-colors hover:bg-white/10">
          <ArrowRight size={16} />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><ClipboardCheck size={24} className="text-gold" /> تقييم جديد</h1>
      </div>
      <EvaluationForm students={students} teachers={teachers} redirectTo="/moderator/evaluations" />
    </div>
  );
}
