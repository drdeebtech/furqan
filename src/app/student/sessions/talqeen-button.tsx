"use client";

import { useState, useTransition } from "react";
import { Mic, X, CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { AudioRecorder } from "@/app/student/follow-up/audio-recorder";
import { createTalqeenHomework, cancelTalqeenHomework } from "./talqeen-actions";

/**
 * Sprint 2.3 — Talqeen primitive (2026-05-05).
 *
 * The single feature that gives FURQAN its Quran-pedagogy identity vs
 * being a generic video-call tool. Mounted on /student/sessions/[id]
 * (during or after the live call). Flow:
 *
 *   1. Idle: shows "Send recording for correction" button.
 *   2. On click: server action `createTalqeenHomework` opens a follow-up
 *      slot scoped to this booking. Returns the new follow-up ID.
 *   3. Mounts the existing AudioRecorder with that ID. Student records
 *      up to 90 seconds via MediaRecorder API.
 *   4. AudioRecorder uploads to the private homework-audio bucket and
 *      calls the existing markStudentReady action — same flow used for
 *      regular follow-up audio submission.
 *   5. Teacher gets a notification + the recording lands in their
 *      normal follow-up grading queue.
 *
 * Reuses the entire audio-submission pipeline shipped earlier in the
 * 2026-05-04 session: storage bucket + RLS + signed URLs + grading UI.
 * The new code is just the "create slot mid-session" bridge.
 */
export function TalqeenButton({ bookingId, studentId }: { bookingId: string; studentId: string }) {
  const { t } = useLang();
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<"idle" | "creating" | "recording" | "done" | "error">("idle");
  const [homeworkId, setHomeworkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    setStage("creating");
    startTransition(async () => {
      const res = await createTalqeenHomework(bookingId);
      if (res.ok) {
        setHomeworkId(res.homeworkId);
        setStage("recording");
      } else {
        setError(res.error);
        setStage("error");
      }
    });
  }

  function dismiss() {
    const hId = homeworkId;
    setStage("idle");
    setHomeworkId(null);
    setError(null);
    // Best-effort cleanup: delete the unsubmitted slot so 'assigned' rows
    // don't accumulate when students back out before recording.
    if (hId) {
      cancelTalqeenHomework(hId).catch(() => {});
    }
  }

  if (stage === "done") {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/10 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-success">
          <CheckCircle size={16} aria-hidden="true" />
          {t(
            "تم إرسال التسميع لمعلمك للتصحيح.",
            "Your recitation was sent to your teacher for correction.",
          )}
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-2 text-xs text-muted hover:text-foreground focus-ring rounded"
        >
          {t("إرسال تسميع آخر", "Send another recitation")}
        </button>
      </div>
    );
  }

  if (stage === "recording" && homeworkId) {
    return (
      <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-violet-300">
            <Mic size={14} aria-hidden="true" />
            {t("تسجيل تسميع للتصحيح", "Record a recitation for correction")}
          </p>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("إلغاء", "Cancel")}
            className="rounded p-1 text-muted-light hover:text-foreground"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <AudioRecorder
          homeworkId={homeworkId}
          studentId={studentId}
          onSubmitted={() => setStage("done")}
          // Talqeen is the audio-IS-the-point flow — if the student opts
          // out of audio, we just dismiss instead of finalizing an empty
          // follow-up row. The created row stays as 'assigned' status;
          // student can come back later or teacher cleans up.
          onSkipAudio={dismiss}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Mic size={14} className="text-violet-400" aria-hidden="true" />
            {t("تسميع للتصحيح", "Talqeen — recitation for correction")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t(
              "سجّل آية أو آيات وأرسلها لمعلمك. سيستمع ويصحّح ثم يرد عليك.",
              "Record an ayah or two and send it to your teacher. They'll listen, correct, and reply.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={pending}
          className="glass-gold glass-pill flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <Mic size={12} aria-hidden="true" />
          {pending
            ? t("جارٍ الإعداد…", "Preparing…")
            : t("ابدأ التسجيل", "Start recording")}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-error">{error}</p>
      )}
    </div>
  );
}
