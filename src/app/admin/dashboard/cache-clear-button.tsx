"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { clearPublicCache } from "@/lib/actions/cache";

type ResultState =
  | { kind: "idle" }
  | { kind: "success"; paths: number; at: string }
  | { kind: "error"; message: string };

export function CacheClearButton() {
  const { t } = useLang();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResultState>({ kind: "idle" });

  function handleClick() {
    startTransition(async () => {
      const r = await clearPublicCache("manual");
      if (r.success) setResult({ kind: "success", paths: r.paths, at: r.at });
      else setResult({ kind: "error", message: r.error ?? "Unknown error" });
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.05))] disabled:opacity-60"
      >
        <RefreshCw
          size={14}
          aria-hidden="true"
          className={pending ? "animate-spin" : ""}
        />
        {pending ? t("جارٍ المسح…", "Clearing…") : t("مسح الذاكرة المؤقتة", "Clear Cache")}
      </button>
      {result.kind === "success" && (
        <span role="status" className="flex items-center gap-1 text-xs text-emerald-500">
          <CheckCircle2 size={12} aria-hidden="true" />
          {t(`تم مسح ${result.paths} مسارًا`, `${result.paths} paths cleared`)}
        </span>
      )}
      {result.kind === "error" && (
        <span role="alert" className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle size={12} aria-hidden="true" /> {result.message}
        </span>
      )}
    </div>
  );
}
