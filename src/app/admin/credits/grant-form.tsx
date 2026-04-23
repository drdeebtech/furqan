"use client";

import { useActionState, useState } from "react";
import { Gift, CheckCircle, AlertCircle } from "lucide-react";
import { grantCreditAction, type GrantResult } from "./actions";

const initialState: GrantResult = {};

export function GrantCreditForm() {
  const [state, formAction, pending] = useActionState(grantCreditAction, initialState);
  const [email, setEmail] = useState("");

  return (
    <section className="rounded-2xl border border-surface-border/60 bg-surface/40 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Gift size={18} className="text-gold" />
        <h2 className="text-lg font-bold">منح جلسات إضافية</h2>
      </div>

      <form action={formAction} className="grid gap-4 sm:grid-cols-[2fr_1fr_2fr_auto]">
        <div>
          <label htmlFor="student_email" className="mb-1 block text-xs font-medium text-muted">
            بريد الطالب
          </label>
          <input
            id="student_email"
            name="student_email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm"
            placeholder="student@example.com"
          />
        </div>
        <div>
          <label htmlFor="sessions" className="mb-1 block text-xs font-medium text-muted">
            عدد الجلسات
          </label>
          <input
            id="sessions"
            name="sessions"
            type="number"
            min={1}
            max={50}
            required
            defaultValue={1}
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor="reason" className="mb-1 block text-xs font-medium text-muted">
            السبب (يُسجَّل في التدقيق)
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            required
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm"
            placeholder="تعويض عن جلسة ملغاة من المعلم"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="glass-gold glass-pill px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-gold-hover disabled:opacity-50"
          >
            {pending ? "..." : "منح"}
          </button>
        </div>
      </form>

      {state.success && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <CheckCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.success}</span>
        </div>
      )}
      {state.error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
    </section>
  );
}
