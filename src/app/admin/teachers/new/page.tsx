import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createTeacher } from "../actions";

export const metadata: Metadata = { title: "إضافة معلم" };

const input = "w-full rounded-xl border border-input-border bg-input px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none";

export default async function NewTeacherPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get users who aren't teachers yet
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, role")
    .neq("role", "teacher").order("full_name").returns<{ id: string; full_name: string | null; role: string }[]>();

  return (
    <div dir="rtl" className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">إضافة معلم جديد</h1>
      <div className="rounded-xl border border-card-border bg-card p-6">
        <form action={createTeacher} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">اختر المستخدم *</label>
            <select name="teacher_id" required className={input}>
              <option value="">اختر مستخدم لتحويله لمعلم</option>
              {(profiles ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.id} ({p.role})</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">السيرة الذاتية</label>
            <textarea name="bio" rows={3} className={`${input} resize-none`} placeholder="نبذة عن المعلم..." />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">السعر بالساعة (USD) *</label>
              <input name="hourly_rate" type="number" required min={1} max={500} className={input} placeholder="25" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">الجنس</label>
              <select name="gender" className={input}><option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option></select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">التخصصات * <span className="text-xs text-muted">(مفصولة بفواصل)</span></label>
            <input name="specialties" required className={input} placeholder="hifz,tajweed,muraja" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">اللغات <span className="text-xs text-muted">(مفصولة بفواصل)</span></label>
            <input name="languages" className={input} defaultValue="ar" placeholder="ar,en" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">معايير القراءة <span className="text-xs text-muted">(مفصولة بفواصل)</span></label>
            <input name="recitation_standards" className={input} defaultValue="hafs" placeholder="hafs,warsh" />
          </div>
          <button type="submit" className="w-full rounded bg-gold py-3 font-semibold text-white transition-colors hover:bg-gold-hover">إنشاء ملف المعلم</button>
        </form>
      </div>
    </div>
  );
}
