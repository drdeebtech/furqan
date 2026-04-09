"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { register, type AuthResult } from "../actions";

export function RegisterForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState<AuthResult, FormData>(
    register,
    {},
  );

  return (
    <>
      <h2 className="font-display mb-1 text-2xl font-bold leading-tight">إنشاء حساب</h2>
      <p className="mb-6 text-sm text-muted">انضم إلى أكاديمية فرقان</p>

      {state.error && (
        <div className="mb-4 rounded-lg glass-danger p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        {/* Full Name */}
        <div>
          <label htmlFor="full_name" className="mb-1 block text-sm font-medium">
            الاسم الكامل
            <span className="mr-2 text-xs text-muted">Full name</span>
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            autoComplete="name"
            className="w-full rounded-xl glass-input px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            placeholder="محمد أحمد"
          />
        </div>

        {/* Email */}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            البريد الإلكتروني
            <span className="mr-2 text-xs text-muted">Email</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            className="w-full rounded-xl glass-input px-4 py-2.5 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            placeholder="you@example.com"
          />
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            كلمة المرور
            <span className="mr-2 text-xs text-muted">
              Password (min 8 characters)
            </span>
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              dir="ltr"
              className="w-full rounded-xl glass-input px-4 py-2.5 pl-10 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-foreground focus-ring"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="confirm_password"
            className="mb-1 block text-sm font-medium"
          >
            تأكيد كلمة المرور
            <span className="mr-2 text-xs text-muted">Confirm password</span>
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            dir="ltr"
            className="w-full rounded-xl glass-input px-4 py-2.5 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            placeholder="••••••••"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-full glass-gold glass-pill py-2.5 font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <>
              <UserPlus size={18} />
              إنشاء حساب
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        لديك حساب بالفعل؟{" "}
        <Link href="/login" className="text-gold hover:text-gold-hover">
          تسجيل الدخول
        </Link>
      </p>
    </>
  );
}
