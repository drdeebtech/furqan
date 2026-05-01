"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrollInOffering } from "@/lib/actions/class-offerings";
import { useLang } from "@/lib/i18n/context";

export function EnrollButton({ offeringId }: { offeringId: string }) {
  const { t } = useLang();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await enrollInOffering(offeringId);
      if (!res || "error" in res && res.error) {
        setError(res?.error ?? t("حدث خطأ", "Error"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="glass-gold glass-pill w-full px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-gold-hover disabled:opacity-50"
      >
        {isPending ? t("جاري التسجيل…", "Enrolling…") : t("سجِّل الآن", "Enroll now")}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
