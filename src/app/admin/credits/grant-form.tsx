"use client";

import { useActionState, useState } from "react";
import { Gift } from "lucide-react";
import { grantCreditAction, type GrantResult } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";

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

      <div className="mt-4">
        <ActionFeedback state={state} />
      </div>
    </section>
  );
}
