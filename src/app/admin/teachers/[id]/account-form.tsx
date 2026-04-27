"use client";

import { useActionState, useState } from "react";
import { Camera, Save, Mail } from "lucide-react";
import {
  updateAccount,
  updateEmail,
  uploadTeacherPhoto,
  type ActionResult,
} from "./actions";
import { Avatar } from "@/components/shared/avatar";

const input =
  "w-full rounded-xl glass-input px-4 py-2.5 text-sm text-foreground focus:border-gold focus:outline-none";

interface AccountFormProps {
  teacherId: string;
  currentEmail: string;
  profile: {
    full_name: string | null;
    full_name_ar: string | null;
    phone: string | null;
    country: string | null;
    timezone: string | null;
    lang: string | null;
    avatar_url: string | null;
    date_of_birth: string | null;
    parent_name: string | null;
    parent_phone: string | null;
    parent_email: string | null;
    is_active: boolean | null;
  };
}

export function AccountForm({ teacherId, currentEmail, profile }: AccountFormProps) {
  const accountAction = updateAccount.bind(null, teacherId);
  const emailAction = updateEmail.bind(null, teacherId);
  const photoActionBound = uploadTeacherPhoto.bind(null, teacherId);

  const [accountState, accountFormAction, accountPending] =
    useActionState<ActionResult, FormData>(accountAction, {});
  const [emailState, emailFormAction, emailPending] =
    useActionState<ActionResult, FormData>(emailAction, {});
  const [photoState, photoFormAction, photoPending] =
    useActionState<ActionResult, FormData>(photoActionBound, {});

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [chosenName, setChosenName] = useState<string | null>(null);

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) {
      setPreviewUrl(null);
      setChosenName(null);
      return;
    }
    setChosenName(f.name);
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  };

  return (
    <div className="space-y-6">
      {/* Photo card */}
      <div className="glass-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Camera size={18} className="text-gold" />
          الصورة الشخصية
          <span className="me-2 text-sm font-normal text-muted">Profile Photo</span>
        </h2>

        {photoState.error && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
            {photoState.error}
          </div>
        )}
        {photoState.success && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
            تم تحديث الصورة بنجاح
          </div>
        )}

        <form action={photoFormAction} className="flex flex-wrap items-center gap-4">
          <Avatar src={previewUrl ?? profile.avatar_url} name={profile.full_name} size={80} />

          <div className="flex-1 space-y-2">
            <label
              htmlFor="admin-teacher-photo"
              className="glass-pill inline-flex cursor-pointer items-center gap-2 border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10"
            >
              <Camera size={14} />
              {chosenName ? "تغيير الصورة" : "اختر صورة من الجهاز"}
            </label>
            <input
              id="admin-teacher-photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onPhotoChange}
              className="sr-only"
            />
            {chosenName && <p className="text-xs text-muted" dir="ltr">{chosenName}</p>}
            <p className="text-xs text-muted">JPG / PNG / WebP — الحد الأقصى 2 ميغابايت</p>
          </div>

          <button
            type="submit"
            disabled={photoPending || !chosenName}
            className="glass-gold glass-pill flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-gold-hover disabled:opacity-50"
          >
            {photoPending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save size={14} />
            )}
            رفع الصورة
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">
          أو الصق رابط CDN في حقل &quot;رابط الصورة&quot; أدناه واضغط حفظ البيانات.
        </p>
      </div>

      {/* Email card */}
      <div className="glass-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Mail size={18} className="text-gold" />
          البريد الإلكتروني
          <span className="me-2 text-sm font-normal text-muted">Email</span>
        </h2>

        {emailState.error && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
            {emailState.error}
          </div>
        )}
        {emailState.success && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
            {emailState.notice ?? "تم الحفظ"}
          </div>
        )}

        <form action={emailFormAction} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="mb-1 block text-xs font-medium text-muted">
              البريد الإلكتروني الحالي: {currentEmail || "—"}
            </label>
            <input
              name="email"
              type="email"
              dir="ltr"
              defaultValue={currentEmail}
              className={`${input} text-left`}
            />
          </div>
          <button
            type="submit"
            disabled={emailPending}
            className="glass-gold glass-pill flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-gold-hover disabled:opacity-50"
          >
            <Save size={14} />
            حفظ البريد
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">
          سيتم إرسال رابط تأكيد إلى البريد الجديد — التغيير لا يسري قبل أن يضغط المعلم على الرابط.
        </p>
      </div>

      {/* Profile card */}
      <div className="glass-card p-6">
        <h2 className="mb-4 text-lg font-semibold">
          بيانات الحساب
          <span className="me-2 text-sm font-normal text-muted">Profile</span>
        </h2>

        {accountState.error && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
            {accountState.error}
          </div>
        )}
        {accountState.success && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
            تم حفظ البيانات بنجاح
          </div>
        )}

        <form action={accountFormAction} className="grid gap-4 md:grid-cols-2">
          <Field label="الاسم الكامل" hint="Full name (English)" name="full_name" defaultValue={profile.full_name ?? ""} />
          <Field label="الاسم بالعربية" hint="Arabic name (manual — shown to Arabic visitors)" name="full_name_ar" defaultValue={profile.full_name_ar ?? ""} />
          <Field label="رقم الجوال" hint="Phone" name="phone" defaultValue={profile.phone ?? ""} ltr />
          <Field label="الدولة" hint="Country" name="country" defaultValue={profile.country ?? ""} />
          <Field label="المنطقة الزمنية" hint="Timezone" name="timezone" defaultValue={profile.timezone ?? ""} ltr placeholder="Africa/Cairo" />
          <Field label="اللغة" hint="Language code" name="lang" defaultValue={profile.lang ?? ""} ltr placeholder="ar / en" />
          <Field label="رابط الصورة" hint="Avatar URL" name="avatar_url" defaultValue={profile.avatar_url ?? ""} ltr type="url" />
          <Field label="تاريخ الميلاد" hint="Date of birth" name="date_of_birth" defaultValue={profile.date_of_birth ?? ""} ltr type="date" />

          <div className="md:col-span-2 mt-2 border-t border-white/10 pt-4 text-sm font-medium text-muted">
            بيانات ولي الأمر <span className="me-1 text-xs">(Guardian)</span>
          </div>
          <Field label="اسم ولي الأمر" hint="Parent name" name="parent_name" defaultValue={profile.parent_name ?? ""} />
          <Field label="جوال ولي الأمر" hint="Parent phone" name="parent_phone" defaultValue={profile.parent_phone ?? ""} ltr />
          <Field label="بريد ولي الأمر" hint="Parent email" name="parent_email" defaultValue={profile.parent_email ?? ""} ltr type="email" />

          <label className="md:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={profile.is_active ?? true} className="accent-gold" />
            <span>الحساب نشط <span className="text-xs text-muted">(active)</span></span>
          </label>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={accountPending}
              className="glass-gold glass-pill flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-gold-hover disabled:opacity-50"
            >
              <Save size={14} />
              حفظ البيانات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  name,
  defaultValue,
  ltr,
  type = "text",
  placeholder,
}: {
  label: string;
  hint: string;
  name: string;
  defaultValue: string;
  ltr?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        <span className="me-2 text-xs text-muted">{hint}</span>
      </label>
      <input
        name={name}
        type={type}
        dir={ltr ? "ltr" : undefined}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`${input} ${ltr ? "text-left" : ""}`}
      />
    </div>
  );
}
