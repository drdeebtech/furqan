"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { WidgetCard } from "@/components/shared/widget-card";
import { useToast } from "@/components/shared/toast";

interface HonorBoardEntry {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  achievement_metric: number | null;
  rank_period: string;
  computed_at: string | null;
}

export function HonorBoardCard() {
  const toast = useToast();
  const [entries, setEntries] = useState<HonorBoardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [optedOut, setOptedOut] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadEntries() {
      try {
        const response = await fetch("/api/honor-board?limit=10", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load honor board");
        const responseBody = (await response.json()) as { data: HonorBoardEntry[] };
        setEntries(responseBody.data);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadEntries();
    return () => controller.abort();
  }, []);

  async function toggleVisibility() {
    const previousValue = optedOut;
    const nextValue = !previousValue;
    setOptedOut(nextValue);
    setSavingPreference(true);

    try {
      const response = await fetch("/api/honor-board/opt-out", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optedOut: nextValue }),
      });
      if (!response.ok) throw new Error("Could not update honor board preference");
    } catch {
      setOptedOut(previousValue);
      toast.error("تعذّر تحديث إعداد لوحة الشرف");
    } finally {
      setSavingPreference(false);
    }
  }

  return (
    <WidgetCard
      title="لوحة الشرف"
      subtitle="أفضل الحفّاظ في الفترة الحالية"
      headerAction={<Trophy className="text-gold" size={20} aria-hidden="true" />}
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-muted">جارٍ التحميل…</p>
      ) : loadError ? (
        <p className="py-6 text-center text-sm text-error">تعذّر تحميل لوحة الشرف.</p>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          ستظهر إنجازات الطلاب هنا قريبًا.
        </p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              className="flex min-h-11 items-center gap-3 rounded-xl bg-foreground/[0.03] px-3 py-2"
            >
              <span className="w-7 shrink-0 text-center text-sm font-bold text-gold" dir="ltr">
                #{index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {entry.display_name?.trim() || "طالب"}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {entry.achievement_metric ?? 0} آية
              </span>
            </li>
          ))}
        </ol>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={optedOut}
        onClick={() => void toggleVisibility()}
        disabled={savingPreference}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[var(--surface-border)] px-3 text-sm transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>{optedOut ? "إظهاري في لوحة الشرف" : "إخفائي من لوحة الشرف"}</span>
        <span
          aria-hidden="true"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${optedOut ? "bg-gold" : "bg-foreground/20"}`}
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-[inset-inline-start] ${optedOut ? "start-6" : "start-1"}`}
          />
        </span>
      </button>
    </WidgetCard>
  );
}
