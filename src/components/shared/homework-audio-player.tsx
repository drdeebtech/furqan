"use client";

import { useState } from "react";
import { Headphones, Loader2, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { getHomeworkAudioUrl } from "@/lib/actions/homework";

interface HomeworkAudioPlayerProps {
  homeworkId: string;
  durationSeconds: number | null;
  /** Optional label override. Default reads naturally for both student and
   *  teacher contexts ("Listen to recitation"). Override when the
   *  surrounding UI carries the recitation framing already. */
  label?: { ar: string; en: string };
}

/**
 * Lazy audio player for a homework's recitation submission. Fetches a
 * signed URL only when the user clicks Play (signed URLs are valid for
 * 1 hour — long enough for a teacher's grading session or a student
 * scanning their own archive).
 *
 * Used by:
 *  - /teacher/homework — when grading a student's submission
 *  - /student/recitations — student's own audio archive
 *  - /student/homework — playback of own submitted recordings
 *
 * RLS gates which paths each role can sign URLs for; the component
 * itself doesn't enforce role.
 */
export function HomeworkAudioPlayer({ homeworkId, durationSeconds, label }: HomeworkAudioPlayerProps) {
  const { t } = useLang();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    if (url || loading) return;
    setLoading(true);
    setError(null);
    const result = await getHomeworkAudioUrl(homeworkId);
    if ("error" in result) {
      setError(result.error);
    } else {
      setUrl(result.url);
    }
    setLoading(false);
  }

  const headerLabel = label
    ? t(label.ar, label.en)
    : t("التسميع", "Recitation");

  if (url) {
    return (
      <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-violet-300">
          <Headphones size={12} aria-hidden="true" />
          {headerLabel}
          {durationSeconds && (
            <span className="text-muted">· {formatDuration(durationSeconds)}</span>
          )}
        </p>
        <audio src={url} controls className="w-full" preload="metadata" />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleLoad}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/15 disabled:opacity-50 focus-ring"
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        ) : (
          <Headphones size={12} aria-hidden="true" />
        )}
        {loading
          ? t("جارٍ التحميل...", "Loading...")
          : t(
              `استمع${durationSeconds ? ` (${formatDuration(durationSeconds)})` : ""}`,
              `Listen${durationSeconds ? ` (${formatDuration(durationSeconds)})` : ""}`,
            )}
      </button>
      {error && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-error">
          <AlertCircle size={11} aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
