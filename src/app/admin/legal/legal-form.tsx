"use client";

import { useActionState } from "react";
import { History, Save } from "lucide-react";
import { updateLegal } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { LoudResult } from "@/lib/actions/loud";
import type { LegalDocument, LegalDocumentVersion } from "@/lib/site-content/legal";

interface Props {
  kind: "terms" | "privacy";
  titleAr: string;
  titleEn: string;
  doc: LegalDocument | null;
  history: LegalDocumentVersion[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function preview(body: string | null, max = 140): string {
  if (!body) return "";
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function LegalForm({ kind, titleAr, titleEn, doc, history }: Props) {
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

      {history.length > 0 && (
        <details className="mt-6 border-t border-[var(--surface-border)] pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted hover:text-foreground">
            <History size={14} aria-hidden="true" />
            <span>الإصدارات السابقة <span className="text-xs">Past versions ({history.length})</span></span>
          </summary>
          <ol className="mt-3 space-y-3 text-xs">
            {history.map((v) => (
              <li key={v.id} className="border-s-2 border-[var(--surface-border)] ps-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono font-semibold">v{v.version}</span>
                  <span className="text-muted">
                    {formatDate(v.effective_at)} → {formatDate(v.superseded_at)}
                  </span>
                </div>
                {v.body_ar && (
                  <p dir="rtl" className="mt-1 line-clamp-2 text-muted">{preview(v.body_ar)}</p>
                )}
                {!v.body_ar && v.body_en && (
                  <p dir="ltr" className="mt-1 line-clamp-2 text-muted">{preview(v.body_en)}</p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
