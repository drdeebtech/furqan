import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, CheckCircle, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "تقدمي" };

const TOPICS = [
  { ar: "مخارج الحروف", en: "Makharij" },
  { ar: "النون الساكنة والتنوين", en: "Noon Saakin" },
  { ar: "أحكام المد", en: "Madd Rules" },
  { ar: "الميم الساكنة", en: "Meem Saakin" },
  { ar: "التفخيم والترقيق", en: "Tafkheem" },
  { ar: "الوقف والابتداء", en: "Waqf Rules" },
];

const ARABIC_NUMS = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩","١٠","١١","١٢","١٣","١٤","١٥","١٦","١٧","١٨","١٩","٢٠","٢١","٢٢","٢٣","٢٤","٢٥","٢٦","٢٧","٢٨","٢٩","٣٠"];

export default async function StudentProgressPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count: completedCount } = await supabase.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id).eq("status", "completed");

  const count = completedCount ?? 0;
  const progressPercent = (count % 10) * 10;
  const nextMilestone = 10 - (count % 10);

  // Recent sessions
  const { data: recent } = await supabase.from("bookings")
    .select("id, teacher_id, scheduled_at, duration_min, session_type")
    .eq("student_id", user.id).eq("status", "completed")
    .order("scheduled_at", { ascending: false }).limit(10)
    .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string }[]>();

  const teacherIds = [...new Set((recent ?? []).map(r => r.teacher_id))];
  let nameMap: Record<string, string> = {};
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", teacherIds).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "معلم"]));
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 font-display text-2xl font-bold">
        <TrendingUp size={24} className="text-gold" /> تقدمي في تعلم القرآن
      </h1>
      <p className="mb-8 text-xs text-muted">My Quran Learning Progress</p>

      {/* Current Level */}
      <div className="mb-8 rounded-2xl border border-gold/30 bg-gold/5 p-8 text-center">
        <p className="text-sm text-muted">مستواك الحالي</p>
        <p className="mt-2 text-2xl font-bold text-gold">مبتدئ</p>
        <p className="font-display mt-4 text-sm text-gold/50">﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾</p>
      </div>

      {/* Sessions Progress */}
      <div className="mb-8 rounded-2xl border border-card-border bg-card p-6">
        <div className="flex items-center justify-between">
          <p className="font-display font-bold">جلسات مكتملة</p>
          <p className="text-2xl font-bold text-gold">{count}</p>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-card-border">
          <div className="h-2 rounded-full bg-gold transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">بعد {nextMilestone} جلسات تصل للمستوى التالي</p>
      </div>

      {/* Tajweed Topics */}
      <div className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold"><BookOpen size={18} className="text-gold" /> مواضيع التجويد</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {TOPICS.map(t => (
            <div key={t.en} className="rounded-2xl border border-card-border bg-card p-4">
              <p className="text-sm font-medium">{t.ar}</p>
              <p className="mt-1 text-xs text-muted">{t.en}</p>
              <span className="mt-2 inline-block rounded-full border border-muted/30 px-2 py-0.5 text-xs text-muted">لم يُدرَس</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quran Journey — 30 Juz */}
      <div className="mb-8">
        <h2 className="mb-4 font-display text-lg font-bold">رحلتك مع القرآن</h2>
        <div className="grid grid-cols-6 gap-2 md:grid-cols-10">
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} className="flex aspect-square items-center justify-center rounded-lg border border-card-border bg-card text-sm font-medium text-muted">
              {ARABIC_NUMS[i + 1]}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">الأجزاء المظللة بالذهبي تعني أنك أتممت حفظها — سيحدثها معلمك</p>
      </div>

      {/* Recent Sessions */}
      {(recent ?? []).length > 0 && (
        <div>
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold"><CheckCircle size={18} className="text-gold" /> آخر الجلسات</h2>
          <div className="space-y-2">
            {(recent ?? []).map(r => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-card-border bg-card px-4 py-3">
                <CheckCircle size={14} className="shrink-0 text-gold" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{nameMap[r.teacher_id] ?? "معلم"}</p>
                </div>
                <p className="text-xs text-muted">{new Date(r.scheduled_at).toLocaleDateString("ar-SA")}</p>
              </div>
            ))}
          </div>
          <Link href="/student/bookings" className="mt-4 inline-block text-sm text-gold hover:text-gold-hover">عرض كل الجلسات ←</Link>
        </div>
      )}
    </div>
  );
}
