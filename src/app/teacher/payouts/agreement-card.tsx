"use client";

// Spec 040 FR-028 — the agreement acceptance card. Explicit affirmative
// action only: unchecked-by-default checkbox + submit (no pre-tick, no
// consent-by-browsing). While the text is a placeholder draft, accept is
// hard-disabled — never record consent to unreviewed text.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptTeacherAgreement } from "@/lib/actions/teacher-payouts";
import { localizePayoutError } from "./error-copy";
import {
  AGREEMENT_BODY_AR,
  AGREEMENT_BODY_EN,
  AGREEMENT_TEXT_IS_PLACEHOLDER,
} from "@/lib/connect/agreement-content";

interface AgreementCardProps {
  /** The version the SERVER rendered this card for (attestation value). */
  version: string;
  lang: "ar" | "en";
}

export function AgreementCard({ version, lang }: AgreementCardProps) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptTeacherAgreement(version);
      if (!result.ok) {
        setError(localizePayoutError(result.errorCode, result.error, lang));
        if (result.versionChanged) router.refresh(); // re-render the new version
        return;
      }
      router.refresh();
    });
  };

  return (
    <section className="glass-card rounded-xl p-6" aria-labelledby="agreement-heading">
      <h2 id="agreement-heading" className="mb-3 text-lg font-bold">
        {t("اتفاقية المعلّم", "Teacher Agreement")}
      </h2>
      <p className="mb-3 text-sm text-muted">
        {t(
          "الموافقة على الاتفاقية شرط لاستلام حجوزات جديدة ولصرف الأرباح.",
          "Accepting the agreement is required to receive new bookings and to get paid.",
        )}
      </p>
      <div
        // Keyboard-reachable scroll region (review P2 — WCAG 2.1.1): a
        // keyboard-only user must be able to scroll the terms they accept.
        tabIndex={0}
        role="region"
        aria-label={t("نص الاتفاقية", "Agreement text")}
        className="mb-4 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-7"
        dir={lang === "ar" ? "rtl" : "ltr"}
      >
        {lang === "ar" ? AGREEMENT_BODY_AR : AGREEMENT_BODY_EN}
      </div>

      {AGREEMENT_TEXT_IS_PLACEHOLDER ? (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {t(
            "النص أعلاه مسودة قيد المراجعة القانونية — تُفعَّل الموافقة عند اعتماد النص النهائي.",
            "The text above is a draft pending legal review — acceptance is enabled once the final text is approved.",
          )}
        </p>
      ) : null}

      <label className="mb-4 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={AGREEMENT_TEXT_IS_PLACEHOLDER || isPending}
          className="mt-1 h-4 w-4"
        />
        <span>
          {t(
            `قرأت اتفاقية المعلّم (النسخة ${version}) وأوافق على بنودها.`,
            `I have read the Teacher Agreement (version ${version}) and agree to its terms.`,
          )}
        </span>
      </label>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-error">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!checked || AGREEMENT_TEXT_IS_PLACEHOLDER || isPending}
        className="glass-button rounded-lg px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? t("جارٍ الحفظ…", "Saving…") : t("أوافق على الاتفاقية", "Accept the agreement")}
      </button>
    </section>
  );
}
