import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateTeacher } from "../actions";

const input = "w-full rounded-xl border border-input-border bg-input px-4 py-3 text-sm text-foreground focus:border-gold focus:outline-none";

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
      <div className="rounded-xl border border-card-border bg-card p-6">
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
            <label className="mb-1 block text-sm font-medium">التخصصات</label>
            <input name="specialties" defaultValue={tp.specialties.join(",")} className={input} />
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
          <button type="submit" className="w-full rounded bg-gold py-3 font-semibold text-white transition-colors hover:bg-gold-hover">حفظ التعديلات</button>
        </form>
      </div>

      {/* Ijaza */}
      {(ijazas ?? []).length > 0 && (
        <div className="mt-6 rounded-xl border border-card-border bg-card p-6">
          <h2 className="mb-4 font-bold">الإجازات</h2>
          <div className="space-y-3">
            {(ijazas ?? []).map(ij => (
              <div key={ij.id} className="rounded-lg border border-card-border bg-surface p-3 text-sm">
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
