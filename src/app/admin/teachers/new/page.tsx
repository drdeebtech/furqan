import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { createTeacher } from "../actions";
import { getActiveTeacherLanguages } from "@/lib/site-content/queries";

export const metadata: Metadata = { title: "إضافة معلم" };

const input = "w-full rounded-xl glass-input px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none";

const SPECIALTIES = [
  { value: "hifz", ar: "حفظ القرآن", en: "Hifz" },
  { value: "tajweed", ar: "التجويد", en: "Tajweed" },
  { value: "muraja", ar: "المراجعة", en: "Revision" },
  { value: "tilawa", ar: "التلاوة", en: "Recitation" },
  { value: "qiraat", ar: "القراءات", en: "Qira'at" },
  { value: "tafsir", ar: "التفسير", en: "Tafsir" },
  { value: "combined", ar: "حفظ + مراجعة", en: "Combined" },
  { value: "other", ar: "أخرى", en: "Other" },
];

const RIWAYAT = [
  { value: "hafs", ar: "حفص عن عاصم" },
  { value: "warsh", ar: "ورش عن نافع" },
  { value: "qalon", ar: "قالون عن نافع" },
  { value: "al_duri", ar: "الدوري عن أبي عمرو" },
  { value: "shu_ba", ar: "شعبة عن عاصم" },
];

export default async function NewTeacherPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const [{ data: profiles }, languages] = await Promise.all([
    // Limit to 100 to prevent payload explosion at scale — this select feeds
    // an HTML <select> that cannot handle 50k rows anyway. Long-term this
    // needs a search-as-you-type API so the page stays usable.
    supabase.from("profiles").select("id, full_name, role")
      .neq("role", "teacher").order("full_name").limit(100).returns<{ id: string; full_name: string | null; role: string }[]>(),
    getActiveTeacherLanguages(),
  ]);

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t("إضافة معلم جديد", "Add New Teacher")}</h1>
      <div className="glass-card rounded-xl p-6">
        <form action={createTeacher} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("اختر المستخدم *", "Select User *")}</label>
            <select name="teacher_id" required className={input}>
              <option value="">{t("اختر مستخدم لتحويله لمعلم", "Select a user to promote to teacher")}</option>
              {(profiles ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.id} ({p.role})</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">{t("السيرة الذاتية (عربي)", "Bio (Arabic)")}</label>
            <textarea name="bio" rows={3} dir="rtl" className={`${input} resize-none`} placeholder={t("نبذة عن المعلم...", "About the teacher...")} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("السيرة الذاتية (إنجليزي)", "Bio (English)")}</label>
            <textarea name="bio_en" rows={3} dir="ltr" className={`${input} resize-none text-left`} placeholder="English bio for students browsing in English" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">{t("السعر بالساعة (USD) *", "Hourly Rate (USD) *")}</label>
              <input name="hourly_rate" type="number" required min={1} max={500} className={input} placeholder="25" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("الجنس", "Gender")}</label>
              <select name="gender" className={input}>
                <option value="">—</option>
                <option value="male">{t("ذكر", "Male")}</option>
                <option value="female">{t("أنثى", "Female")}</option>
              </select>
            </div>
          </div>

          {/* Specialties — checkboxes */}
          <div>
            <label className="mb-2 block text-sm font-medium">{t("التخصصات *", "Specialties *")}</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {SPECIALTIES.map(s => (
                <label key={s.value} className="flex cursor-pointer items-center gap-2 rounded-lg glass-input px-3 py-2.5 text-sm transition-colors has-[:checked]:border-gold has-[:checked]:bg-gold/10">
                  <input type="checkbox" name="specialties" value={s.value} className="h-4 w-4 accent-gold" />
                  <span>{lang === "ar" ? s.ar : s.en}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Recitation standards — checkboxes */}
          <div>
            <label className="mb-2 block text-sm font-medium">{t("معايير القراءة", "Recitation Standards")}</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {RIWAYAT.map(r => (
                <label key={r.value} className="flex cursor-pointer items-center gap-2 rounded-lg glass-input px-3 py-2.5 text-sm transition-colors has-[:checked]:border-gold has-[:checked]:bg-gold/10">
                  <input type="checkbox" name="recitation_standards" value={r.value} defaultChecked={r.value === "hafs"} className="h-4 w-4 accent-gold" />
                  <span>{r.ar}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Languages — checkboxes (consistent with /teach-with-us/apply + CV edit) */}
          <div>
            <label className="mb-2 block text-sm font-medium">{t("اللغات", "Languages")}</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {languages.map(l => (
                <label key={l.key} className="flex cursor-pointer items-center gap-2 rounded-lg glass-input px-3 py-2.5 text-sm transition-colors has-[:checked]:border-gold has-[:checked]:bg-gold/10">
                  <input type="checkbox" name="languages" value={l.key} defaultChecked={l.key === "ar"} className="h-4 w-4 accent-gold" />
                  <span>{lang === "ar" ? l.label_ar : l.label_en}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className="w-full glass-gold glass-pill py-3 font-semibold transition-colors">
            {t("إنشاء ملف المعلم", "Create Teacher Profile")}
          </button>
        </form>
      </div>
    </div>
  );
}
