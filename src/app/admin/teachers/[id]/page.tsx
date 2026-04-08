import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateTeacher } from "../actions";

const input = "w-full rounded-xl glass-input px-4 py-3 text-sm text-foreground focus:border-gold focus:outline-none";

interface Props { params: Promise<{ id: string }>; }

export default async function TeacherDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: tp } = await supabase.from("teacher_profiles")
    .select("teacher_id, bio, specialties, hourly_rate, gender, languages, recitation_standards, is_accepting, is_archived, total_sessions, rating_avg")
    .eq("teacher_id", id).single<{
      teacher_id: string; bio: string | null; specialties: string[]; hourly_rate: number;
      gender: string | null; languages: string[]; recitation_standards: string[];
      is_accepting: boolean; is_archived: boolean; total_sessions: number; rating_avg: number;
    }>();

  if (!tp) redirect("/admin/teachers");

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", id)
    .single<{ full_name: string | null }>();

  const { data: ijazas } = await supabase.from("teacher_ijaza").select("id, riwaya, chain_text, granted_by, verified_at")
    .eq("teacher_id", id).returns<{ id: string; riwaya: string; chain_text: string; granted_by: string | null; verified_at: string | null }[]>();

  const { count: bookingCount } = await supabase.from("bookings").select("id", { count: "exact", head: true }).eq("teacher_id", id);

  return (
    <div dir="rtl" className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin/teachers" className="mb-6 inline-block text-sm text-gold hover:text-gold-light">→ العودة للمعلمين</Link>

      <h1 className="mb-2 text-2xl font-bold">{profile?.full_name ?? "معلم"}</h1>
      <div className="mb-6 flex gap-3 text-sm text-muted">
        <span>{tp.total_sessions} جلسة</span>
        <span>تقييم {Number(tp.rating_avg).toFixed(1)}</span>
        <span>{bookingCount ?? 0} حجز</span>
      </div>

      {/* Edit form */}
      <div className="glass-card rounded-xl p-6">
        <h2 className="mb-4 font-bold">تعديل الملف</h2>
        <form action={updateTeacher} className="space-y-4">
          <input type="hidden" name="teacher_id" value={tp.teacher_id} />
          <div>
            <label className="mb-1 block text-sm font-medium">السيرة الذاتية</label>
            <textarea name="bio" rows={3} defaultValue={tp.bio ?? ""} className={`${input} resize-none`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">السعر/ساعة *</label>
              <input name="hourly_rate" type="number" required defaultValue={tp.hourly_rate} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">الجنس</label>
              <select name="gender" defaultValue={tp.gender ?? ""} className={input}><option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option></select>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">التخصصات</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                { value: "hifz", ar: "حفظ القرآن" },
                { value: "tajweed", ar: "التجويد" },
                { value: "muraja", ar: "المراجعة" },
                { value: "tilawa", ar: "التلاوة" },
                { value: "qiraat", ar: "القراءات" },
                { value: "tafsir", ar: "التفسير" },
                { value: "combined", ar: "حفظ + مراجعة" },
                { value: "other", ar: "أخرى" },
              ].map(s => (
                <label key={s.value} className="flex cursor-pointer items-center gap-2 rounded-lg glass-input px-3 py-2.5 text-sm transition-colors has-[:checked]:border-gold has-[:checked]:bg-gold/10">
                  <input type="checkbox" name="specialties" value={s.value} defaultChecked={tp.specialties.includes(s.value)} className="h-4 w-4 accent-gold" />
                  <span>{s.ar}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">معايير القراءة</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {[
                { value: "hafs", ar: "حفص عن عاصم" },
                { value: "warsh", ar: "ورش عن نافع" },
                { value: "qalon", ar: "قالون عن نافع" },
                { value: "al_duri", ar: "الدوري" },
                { value: "shu_ba", ar: "شعبة" },
              ].map(r => (
                <label key={r.value} className="flex cursor-pointer items-center gap-2 rounded-lg glass-input px-3 py-2.5 text-sm transition-colors has-[:checked]:border-gold has-[:checked]:bg-gold/10">
                  <input type="checkbox" name="recitation_standards" value={r.value} defaultChecked={tp.recitation_standards.includes(r.value)} className="h-4 w-4 accent-gold" />
                  <span>{r.ar}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">اللغات</label>
            <input name="languages" defaultValue={tp.languages.join(",")} className={input} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">معايير القراءة</label>
            <input name="recitation_standards" defaultValue={tp.recitation_standards.join(",")} className={input} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" name="is_accepting" id="accepting" defaultChecked={tp.is_accepting} className="accent-gold" />
            <label htmlFor="accepting" className="text-sm">يقبل طلاب جدد</label>
          </div>
          <button type="submit" className="w-full glass-gold glass-pill py-3 font-semibold transition-colors">حفظ التعديلات</button>
        </form>
      </div>

      {/* Ijaza */}
      {(ijazas ?? []).length > 0 && (
        <div className="mt-6 glass-card rounded-xl p-6">
          <h2 className="mb-4 font-bold">الإجازات</h2>
          <div className="space-y-3">
            {(ijazas ?? []).map(ij => (
              <div key={ij.id} className="glass-card rounded-lg p-3 text-sm">
                <p className="font-medium">{ij.riwaya} — {ij.granted_by ?? "غير محدد"}</p>
                <p className="mt-1 text-xs text-muted">{ij.chain_text}</p>
                <p className="mt-1 text-xs">{ij.verified_at ? <span className="text-emerald-400">✓ موثقة</span> : <span className="text-amber-400">بانتظار التوثيق</span>}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
