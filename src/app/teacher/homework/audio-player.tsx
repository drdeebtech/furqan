"use client";

import { useState } from "react";
import { Headphones, Loader2, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { getHomeworkAudioUrl } from "@/lib/actions/homework";

interface HomeworkAudioPlayerProps {
  homeworkId: string;
  durationSeconds: number | null;
}

/**
 * Teacher-side player for the student's recitation submission. Lazy:
 * fetches a signed URL only when the teacher clicks Play, since most
 * homework rows on the page won't be opened. Once fetched, the URL stays
 * for the page lifetime (signed URLs are valid for 1 hour — long enough
 * for a grading session).
 */
export function HomeworkAudioPlayer({ homeworkId, durationSeconds }: HomeworkAudioPlayerProps) {
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

  if (url) {
    return (
      <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-violet-300">
          <Headphones size={12} aria-hidden="true" />
          {t("تسميع الطالب", "Student's recitation")}
          {durationSeconds && (
            <span className="text-muted">· {formatDuration(durationSeconds)}</span>
          )}
        </p>
        <audio src={url} controls className="w-full" preload="metadata" />
      </div>
    );
  }

  return (
    <div className="mt-2">
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
              `استمع للتسميع${durationSeconds ? ` (${formatDuration(durationSeconds)})` : ""}`,
              `Listen to recitation${durationSeconds ? ` (${formatDuration(durationSeconds)})` : ""}`,
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
