import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, TrendingUp, Inbox, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "تقدمي" };

interface ProgressRow {
  id: string;
  teacher_id: string;
  progress_type: string;
  surah_from: number | null;
  ayah_from: number | null;
  surah_to: number | null;
  ayah_to: number | null;
  pages_reviewed: number | null;
  quality_rating: number | null;
  level: string;
  teacher_notes: string | null;
  created_at: string;
}

interface ErrorRow {
  id: string;
  progress_id: string;
  surah_num: number | null;
  ayah_num: number;
  error_type: string;
  note: string | null;
  resolved: boolean;
}

const PROGRESS_AR: Record<string, string> = { new: "حفظ جديد", muraja: "مراجعة", correction: "تصحيح" };
const ERROR_AR: Record<string, string> = { makharij: "مخارج", sifat: "صفات", madd: "مدود", waqf: "وقف", ghunna: "غنة", other: "أخرى" };
const LEVEL_AR: Record<string, string> = { beginner: "مبتدئ", intermediate: "متوسط", advanced: "متقدم" };

export default async function StudentProgressPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [progressRes, errorsRes] = await Promise.all([
    supabase.from("student_progress")
      .select("id, teacher_id, progress_type, surah_from, ayah_from, surah_to, ayah_to, pages_reviewed, quality_rating, level, teacher_notes, created_at")
      .eq("student_id", user.id).order("created_at", { ascending: false }).returns<ProgressRow[]>(),
    supabase.from("recitation_errors")
      .select("id, progress_id, surah_num, ayah_num, error_type, note, resolved").returns<ErrorRow[]>(),
  ]);

  const progress = progressRes.data ?? [];
  const allErrors = errorsRes.data ?? [];
  const errorMap = new Map<string, ErrorRow[]>();
  for (const e of allErrors) { errorMap.set(e.progress_id, [...(errorMap.get(e.progress_id) ?? []), e]); }

  let nameMap: Record<string, string> = {};
  if (progress.length > 0) {
    const ids = [...new Set(progress.map((p) => p.teacher_id))];
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "معلم"]));
  }

  const totalPages = progress.reduce((s, p) => s + (p.pages_reviewed ?? 0), 0);
  const unresolved = allErrors.filter((e) => !e.resolved).length;

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <TrendingUp size={24} className="text-gold" /> تقدمي في الحفظ
      </h1>

      <div className="mb-8 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-card-border bg-card p-4">
          <p className="text-sm text-muted">جلسات مسجلة</p>
          <p className="mt-1 text-2xl font-bold text-gold">{progress.length}</p>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4">
          <p className="text-sm text-muted">صفحات مراجعة</p>
          <p className="mt-1 text-2xl font-bold text-gold">{totalPages}</p>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4">
          <p className="text-sm text-muted">أخطاء غير محلولة</p>
          <p className="mt-1 text-2xl font-bold text-gold">{unresolved}</p>
        </div>
      </div>

      {progress.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد سجلات تقدم بعد</p>
          <p className="mt-1 text-sm text-muted">سيسجل المعلم تقدمك بعد كل جلسة</p>
          <Link href="/student/teachers" className="mt-4 inline-block rounded bg-gold px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gold-hover">تصفح المعلمين</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {progress.map((p) => {
            const errors = errorMap.get(p.id) ?? [];
            return (
              <div key={p.id} className="rounded-xl border border-card-border bg-card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs text-gold">{PROGRESS_AR[p.progress_type] ?? p.progress_type}</span>
                      <span className="rounded-full border border-card-border px-2 py-0.5 text-xs text-muted">{LEVEL_AR[p.level] ?? p.level}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{nameMap[p.teacher_id] ?? "معلم"}</p>
                    <p className="text-xs text-muted">{new Date(p.created_at).toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" })}</p>
                  </div>
                  {p.quality_rating && (
                    <div className="text-center">
                      <p className="text-2xl font-bold text-gold">{p.quality_rating}</p>
                      <p className="text-xs text-muted">/ ٥</p>
                    </div>
                  )}
                </div>

                {p.surah_from && p.surah_to && (
                  <div className="mt-3 rounded-lg border border-card-border bg-surface p-3 text-sm">
                    <BookOpen size={14} className="mb-1 inline text-gold" /> سورة {p.surah_from}{p.ayah_from ? `:${p.ayah_from}` : ""} — سورة {p.surah_to}{p.ayah_to ? `:${p.ayah_to}` : ""}
                    {p.pages_reviewed && <span className="mr-2 text-muted">· {p.pages_reviewed} صفحات</span>}
                  </div>
                )}

                {p.teacher_notes && (
                  <div className="mt-3 rounded-lg border border-card-border bg-surface p-3">
                    <p className="mb-1 text-xs font-medium text-gold">ملاحظات المعلم</p>
                    <p className="text-sm text-muted">{p.teacher_notes}</p>
                  </div>
                )}

                {errors.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-xs font-medium text-muted"><AlertTriangle size={12} className="inline" /> أخطاء التلاوة ({errors.length})</p>
                    <div className="space-y-1">
                      {errors.map((e) => (
                        <div key={e.id} className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-xs ${e.resolved ? "bg-surface text-muted line-through" : "border border-amber-500/20 bg-amber-500/5 text-amber-400"}`}>
                          <span>{ERROR_AR[e.error_type] ?? e.error_type}{e.surah_num && ` — ${e.surah_num}:${e.ayah_num}`}{e.note && ` — ${e.note}`}</span>
                          <span>{e.resolved ? "✓" : "قيد الحل"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
