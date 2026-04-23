"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { UserPlus, ArrowRight, CheckCircle } from "lucide-react";
import { createUserFromScratch } from "../actions";

const inputClass =
  "w-full rounded-xl glass-input px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus";

export function CreateUserForm() {
  const [role, setRole] = useState("student");
  const [state, formAction, pending] = useActionState<
    { success?: boolean; error?: string },
    FormData
  >(createUserFromScratch, {});

  if (state.success) {
    return (
      <div dir="rtl" className="mx-auto max-w-lg px-4 py-12">
        <div className="glass-card rounded-xl p-8 text-center">
          <CheckCircle size={48} className="mx-auto mb-4 text-emerald-400" />
          <h2 className="mb-2 text-xl font-bold text-gold">تم إنشاء المستخدم بنجاح</h2>
          <p className="mb-6 text-sm text-muted">يمكن للمستخدم الآن تسجيل الدخول بالبريد الإلكتروني وكلمة المرور</p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/admin/users"
              className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium"
            >
              العودة للمستخدمين
            </Link>
            <Link
              href="/admin/users/new"
              className="glass glass-pill px-4 py-2 text-sm font-medium text-foreground"
            >
              إنشاء مستخدم آخر
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="mx-auto max-w-lg px-4 py-8">
      <Link
        href="/admin/users"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowRight size={14} />
        العودة للمستخدمين
      </Link>

      <div className="glass-card rounded-xl p-6">
        <h1 className="mb-1 text-xl font-bold text-gold">إنشاء مستخدم جديد</h1>
        <p className="mb-6 text-sm text-muted">إضافة حساب جديد للأكاديمية</p>

        {state.error && (
          <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-4">
          {/* Full Name */}
          <div>
            <label htmlFor="full_name" className="mb-1 block text-sm font-medium">
              الاسم الكامل
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              className={inputClass}
              placeholder="محمد أحمد"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              البريد الإلكتروني
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
              كلمة المرور <span className="text-xs text-muted">(8 أحرف على الأقل)</span>
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
              الدور
            </label>
            <select
              id="role"
              name="role"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputClass}
            >
              <option value="student">طالب</option>
              <option value="teacher">معلم</option>
              <option value="moderator">مشرف</option>
            </select>
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium">
              رقم الهاتف <span className="text-xs text-muted">(اختياري)</span>
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
              الدولة <span className="text-xs text-muted">(اختياري)</span>
            </label>
            <input
              id="country"
              name="country"
              type="text"
              className={inputClass}
              placeholder="السعودية"
            />
          </div>

          {/* Student-specific parent fields */}
          {role === "student" && (
            <div className="space-y-4 glass-card rounded-xl p-4">
              <p className="text-sm font-medium text-gold">
                بيانات ولي الأمر <span className="text-xs text-muted">(اختياري)</span>
              </p>

              <div>
                <label htmlFor="parent_name" className="mb-1 block text-sm font-medium">
                  اسم ولي الأمر
                </label>
                <input
                  id="parent_name"
                  name="parent_name"
                  type="text"
                  className={inputClass}
                  placeholder="أحمد محمد"
                />
              </div>

              <div>
                <label htmlFor="parent_phone" className="mb-1 block text-sm font-medium">
                  هاتف ولي الأمر
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
                  بريد ولي الأمر
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
                  تاريخ الميلاد
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
                إنشاء المستخدم
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
