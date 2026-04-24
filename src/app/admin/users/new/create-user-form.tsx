"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { UserPlus, ArrowRight, CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { createUserFromScratch } from "../actions";

const inputClass =
  "w-full rounded-xl glass-input px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus";

export function CreateUserForm() {
  const { t, dir } = useLang();
  const [role, setRole] = useState("student");
  const [state, formAction, pending] = useActionState<
    { success?: boolean; error?: string },
    FormData
  >(createUserFromScratch, {});

  if (state.success) {
    return (
      <div dir={dir} className="mx-auto max-w-lg px-4 py-12">
        <div className="glass-card rounded-xl p-8 text-center">
          <CheckCircle size={48} className="mx-auto mb-4 text-emerald-400" />
          <h2 className="mb-2 text-xl font-bold text-gold">{t("تم إنشاء المستخدم بنجاح", "User created successfully")}</h2>
          <p className="mb-6 text-sm text-muted">{t("يمكن للمستخدم الآن تسجيل الدخول بالبريد الإلكتروني وكلمة المرور", "The user can now log in with the email and password")}</p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/admin/users"
              className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium"
            >
              {t("العودة للمستخدمين", "Back to Users")}
            </Link>
            <Link
              href="/admin/users/new"
              className="glass glass-pill px-4 py-2 text-sm font-medium text-foreground"
            >
              {t("إنشاء مستخدم آخر", "Create another user")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir={dir} className="mx-auto max-w-lg px-4 py-8">
      <Link
        href="/admin/users"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowRight size={14} />
        {t("العودة للمستخدمين", "Back to Users")}
      </Link>

      <div className="glass-card rounded-xl p-6">
        <h1 className="mb-1 text-xl font-bold text-gold">{t("إنشاء مستخدم جديد", "Create New User")}</h1>
        <p className="mb-6 text-sm text-muted">{t("إضافة حساب جديد للأكاديمية", "Add a new account to the academy")}</p>

        {state.error && (
          <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-4">
          {/* Full Name */}
          <div>
            <label htmlFor="full_name" className="mb-1 block text-sm font-medium">
              {t("الاسم الكامل", "Full Name")}
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              className={inputClass}
              placeholder={t("محمد أحمد", "John Doe")}
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              {t("البريد الإلكتروني", "Email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              dir="ltr"
              className={`${inputClass} text-left`}
              placeholder="user@example.com"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              {t("كلمة المرور", "Password")} <span className="text-xs text-muted">{t("(8 أحرف على الأقل)", "(min 8 characters)")}</span>
            </label>
            <input
              id="password"
              name="password"
              type="text"
              required
              minLength={8}
              dir="ltr"
              className={`${inputClass} text-left`}
              placeholder="********"
            />
          </div>

          {/* Role */}
          <div>
            <label htmlFor="role" className="mb-1 block text-sm font-medium">
              {t("الدور", "Role")}
            </label>
            <select
              id="role"
              name="role"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputClass}
            >
              <option value="student">{t("طالب", "Student")}</option>
              <option value="teacher">{t("معلم", "Teacher")}</option>
              <option value="moderator">{t("مشرف", "Moderator")}</option>
            </select>
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium">
              {t("رقم الهاتف", "Phone")} <span className="text-xs text-muted">{t("(اختياري)", "(optional)")}</span>
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              dir="ltr"
              className={`${inputClass} text-left`}
              placeholder="+966..."
            />
          </div>

          {/* Country */}
          <div>
            <label htmlFor="country" className="mb-1 block text-sm font-medium">
              {t("الدولة", "Country")} <span className="text-xs text-muted">{t("(اختياري)", "(optional)")}</span>
            </label>
            <input
              id="country"
              name="country"
              type="text"
              className={inputClass}
              placeholder={t("السعودية", "Saudi Arabia")}
            />
          </div>

          {/* Student-specific parent fields */}
          {role === "student" && (
            <div className="space-y-4 glass-card rounded-xl p-4">
              <p className="text-sm font-medium text-gold">
                {t("بيانات ولي الأمر", "Parent Information")} <span className="text-xs text-muted">{t("(اختياري)", "(optional)")}</span>
              </p>

              <div>
                <label htmlFor="parent_name" className="mb-1 block text-sm font-medium">
                  {t("اسم ولي الأمر", "Parent Name")}
                </label>
                <input
                  id="parent_name"
                  name="parent_name"
                  type="text"
                  className={inputClass}
                  placeholder={t("أحمد محمد", "Ahmed Mohamed")}
                />
              </div>

              <div>
                <label htmlFor="parent_phone" className="mb-1 block text-sm font-medium">
                  {t("هاتف ولي الأمر", "Parent Phone")}
                </label>
                <input
                  id="parent_phone"
                  name="parent_phone"
                  type="tel"
                  dir="ltr"
                  className={`${inputClass} text-left`}
                  placeholder="+966..."
                />
              </div>

              <div>
                <label htmlFor="parent_email" className="mb-1 block text-sm font-medium">
                  {t("بريد ولي الأمر", "Parent Email")}
                </label>
                <input
                  id="parent_email"
                  name="parent_email"
                  type="email"
                  dir="ltr"
                  className={`${inputClass} text-left`}
                  placeholder="parent@example.com"
                />
              </div>

              <div>
                <label htmlFor="date_of_birth" className="mb-1 block text-sm font-medium">
                  {t("تاريخ الميلاد", "Date of Birth")}
                </label>
                <input
                  id="date_of_birth"
                  name="date_of_birth"
                  type="date"
                  dir="ltr"
                  className={`${inputClass} text-left`}
                />
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 glass-gold glass-pill py-2.5 font-semibold transition-colors disabled:opacity-50"
          >
            {pending ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                <UserPlus size={18} />
                {t("إنشاء المستخدم", "Create User")}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
