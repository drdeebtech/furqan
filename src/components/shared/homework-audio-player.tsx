"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Headphones, Loader2, AlertCircle, Flag } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { getFollowUpAudioUrl } from "@/lib/actions/follow-up";

// Talqeen review (#541): madd/ghunna duration errors are only audible at
// reduced speed, so teachers need 0.5x/0.75x. 1.0x stays the default.
const SPEEDS = [0.5, 0.75, 1] as const;
const SKIP_SECONDS = 5;

// The "active" player — the one the teacher last started. Tracked at module
// scope so the keyboard shortcuts target a single player across the many rows
// in the Talqeen queue, and so Space still resumes after a pause (gating on
// isPlaying used to drop the listener on pause). (#541 CR)
let activePlayer: HTMLAudioElement | null = null;

interface HomeworkAudioPlayerProps {
  homeworkId: string;
  durationSeconds: number | null;
  /** Optional label override. Default reads naturally for both student and
   *  teacher contexts ("Listen to recitation"). Override when the
   *  surrounding UI carries the recitation framing already. */
  label?: { ar: string; en: string };
  /** Talqeen-only (#541): when set, renders a "tag error at current time"
   *  button and reports the current playback position (seconds) so the grade
   *  form can pre-fill an error row stamped with that moment. */
  onTagError?: (currentSec: number) => void;
}

/**
 * Lazy audio player for a homework's recitation submission. Fetches a
 * signed URL only when the user clicks Play (signed URLs are valid for
 * 1 hour — long enough for a teacher's grading session or a student
 * scanning their own archive).
 *
 * Used by:
 *  - /teacher/follow-up — when grading a student's submission
 *  - /student/recitations — student's own audio archive
 *  - /student/follow-up — playback of own submitted recordings
 *
 * RLS gates which paths each role can sign URLs for; the component
 * itself doesn't enforce role.
 */
export function HomeworkAudioPlayer({ homeworkId, durationSeconds, label, onTagError }: HomeworkAudioPlayerProps) {
  const { t } = useLang();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  async function handleLoad() {
    if (url || loading) return;
    setLoading(true);
    setError(null);
    const result = await getFollowUpAudioUrl(homeworkId);
    if ("error" in result) {
      setError(result.error);
    } else {
      setUrl(result.url);
    }
    setLoading(false);
  }

  const applySpeed = useCallback((rate: number) => {
    setSpeed(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, []);

  // Keyboard shortcuts: bound for the lifetime of this loaded player, but only
  // act when THIS audio is the active one (the last started). That keeps a
  // single player in control across the queue AND lets Space resume after a
  // pause. Ignore keys while typing in a field (text-field guard).
  useEffect(() => {
    if (!url) return;
    const node = audioRef.current; // stable for this player's lifetime; used in cleanup
    function onKey(e: KeyboardEvent) {
      const audio = audioRef.current;
      if (!audio || audio !== activePlayer) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (audio.paused) void audio.play(); else audio.pause();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - SKIP_SECONDS);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + SKIP_SECONDS);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (activePlayer === node) activePlayer = null;
    };
  }, [url]);

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
        <audio
          ref={audioRef}
          aria-label={headerLabel}
          src={url}
          controls
          className="w-full"
          preload="metadata"
          onPlay={() => { activePlayer = audioRef.current; if (audioRef.current) audioRef.current.playbackRate = speed; }}
          onEnded={() => { if (activePlayer === audioRef.current) activePlayer = null; }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">{t("السرعة", "Speed")}:</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => applySpeed(s)}
              aria-pressed={speed === s}
              className={`min-h-11 min-w-11 rounded-full border px-3 py-2 text-xs font-medium transition-colors focus-ring ${
                speed === s
                  ? "border-violet-400/60 bg-violet-500/20 text-violet-200"
                  : "border-card-border bg-card/30 text-muted hover:bg-card/50"
              }`}
            >
              {s}×
            </button>
          ))}
          {onTagError && (
            <button
              type="button"
              onClick={() => onTagError(audioRef.current?.currentTime ?? 0)}
              className="ms-auto inline-flex min-h-11 items-center gap-1 rounded-full border border-error/40 bg-error/10 px-4 py-2 text-xs font-medium text-red-300 hover:bg-error/20 focus-ring"
            >
              <Flag size={11} aria-hidden="true" />
              {t("وسم خطأ هنا", "Tag error here")}
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-light">
          {t("مسافة: تشغيل/إيقاف · ← →: ±5ث", "Space: play/pause · ← →: ±5s")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleLoad}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/15 disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
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
