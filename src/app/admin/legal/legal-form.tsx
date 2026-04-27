"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { updateLegal } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { LoudResult } from "@/lib/actions/loud";
import type { LegalDocument } from "@/lib/site-content/legal";

interface Props {
  kind: "terms" | "privacy";
  titleAr: string;
  titleEn: string;
  doc: LegalDocument | null;
}

export function LegalForm({ kind, titleAr, titleEn, doc }: Props) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(updateLegal, null);
  const usingFallback = !doc?.body_ar && !doc?.body_en;

  return (
    <section className="glass-card p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          {titleAr} <span className="me-2 text-sm font-normal text-muted">{titleEn}</span>
        </h2>
        <span className="text-xs text-muted">
          {usingFallback ? "يعرض النص الأصلي / Showing fallback" : `الإصدار ${doc?.version ?? 1}`}
        </span>
      </div>

      <ActionFeedback state={state} />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="kind" value={kind} />

        <div>
          <label htmlFor={`${kind}-ar`} className="mb-1 block text-sm font-medium">
            النص بالعربية <span className="text-xs text-muted">Arabic body</span>
          </label>
          <textarea
            id={`${kind}-ar`}
            name="body_ar"
            rows={14}
            dir="rtl"
            defaultValue={doc?.body_ar ?? ""}
            placeholder="اترك فارغاً لعرض النص الأصلي. مثال:&#10;&#10;## ١. الخدمة&#10;&#10;نقدم تعليم القرآن عبر الإنترنت.&#10;&#10;- جلسات فيديو مباشرة&#10;- معلمون معتمدون"
            className="glass-input w-full resize-y rounded-xl px-4 py-3 font-mono text-xs leading-relaxed focus:border-gold focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor={`${kind}-en`} className="mb-1 block text-sm font-medium">
            English body <span className="text-xs text-muted">النص بالإنجليزية</span>
          </label>
          <textarea
            id={`${kind}-en`}
            name="body_en"
            rows={14}
            dir="ltr"
            defaultValue={doc?.body_en ?? ""}
            placeholder="Leave empty to show the in-code fallback. Example:&#10;&#10;## 1. Service&#10;&#10;We provide online Quran education.&#10;&#10;- Live video sessions&#10;- Ijazah-certified teachers"
            className="glass-input w-full resize-y rounded-xl px-4 py-3 font-mono text-xs leading-relaxed focus:border-gold focus:outline-none"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="glass-gold glass-pill flex min-h-[44px] items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-gold-hover disabled:opacity-50"
          >
            {pending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save size={14} aria-hidden="true" />
            )}
            حفظ
          </button>
        </div>
      </form>
    </section>
  );
}
