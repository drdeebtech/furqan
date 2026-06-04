"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Upload, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { logWarn } from "@/lib/logger";
import { markStudentReady } from "@/lib/actions/homework";

const MAX_DURATION_SECONDS = 90;
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

interface AudioRecorderProps {
  homeworkId: string;
  studentId: string;
  /** Called after audio is uploaded AND markStudentReady succeeds. */
  onSubmitted?: () => void;
  /** Called when the student picks "skip audio" so the parent can fall
   *  back to plain markStudentReady (no audio). */
  onSkipAudio: () => Promise<void> | void;
}

type Stage = "idle" | "permission" | "recording" | "previewing" | "uploading" | "error";

/**
 * In-card audio recorder for student follow-up submission. Captures up to
 * MAX_DURATION_SECONDS via the browser MediaRecorder API, lets the student
 * preview/re-record, then uploads to the private `homework-audio` Storage
 * bucket and finalizes by calling markStudentReady with the path. Path is
 * always {student_id}/{homework_id}/{ts}.webm so storage RLS can verify
 * ownership without joining homework_assignments.
 */
export function AudioRecorder({ homeworkId, studentId, onSubmitted, onSkipAudio }: AudioRecorderProps) {
  const { t } = useLang();

  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds, during recording
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);
  // Tracks the latest blob URL so the unmount cleanup can revoke it even
  // though the effect only runs once. State captures the value at mount
  // (always null); the ref always holds the current value.
  const audioUrlRef = useRef<string | null>(null);

  // Clean up the object URL when the component unmounts — otherwise the
  // browser leaks blob: references.
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      stopStream();
      stopTick();
    };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }
  function stopTick() {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function handleStartRecording() {
    setErrorMsg(null);
    setStage("permission");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setStage("error");
      setErrorMsg(
        err && typeof err === "object" && "name" in err && (err as Error).name === "NotAllowedError"
          ? t("لم يتم منح إذن الميكروفون", "Microphone permission was denied")
          : t("تعذّر الوصول إلى الميكروفون", "Couldn't access the microphone"),
      );
      return;
    }
    streamRef.current = stream;

    // Pick the first MIME type the browser supports. Safari and older
    // Chromes lack opus; we fall back gracefully.
    const mime = PREFERRED_MIME_TYPES.find(m => MediaRecorder.isTypeSupported?.(m)) ?? "";
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
      setAudioBlob(blob);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setStage("previewing");
      stopStream();
      stopTick();
    };

    recorder.start();
    setStage("recording");
    setElapsed(0);

    const startedAt = Date.now();
    tickRef.current = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_DURATION_SECONDS) {
        if (recorder.state === "recording") recorder.stop();
      }
    }, 250);
  }

  function handleStopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  function handleDiscard() {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudioBlob(null);
    setAudioUrl(null);
    setStage("idle");
    setElapsed(0);
  }

  async function handleSubmit() {
    if (!audioBlob) return;
    setStage("uploading");
    setErrorMsg(null);

    const ts = Date.now();
    const ext = audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm";
    const path = `${studentId}/${homeworkId}/${ts}.${ext}`;

    const supabase = createClient();
    const { error: uploadErr } = await supabase
      .storage
      .from("homework-audio")
      .upload(path, audioBlob, {
        contentType: audioBlob.type || "audio/webm",
        upsert: false,
      });

    if (uploadErr) {
      setStage("previewing");
      setErrorMsg(t(`فشل الرفع: ${uploadErr.message}`, `Upload failed: ${uploadErr.message}`));
      return;
    }

    const result = await markStudentReady(homeworkId, {
      path,
      durationSeconds: Math.max(1, Math.min(elapsed || 1, MAX_DURATION_SECONDS)),
    });

    if ("error" in result && result.error) {
      // Best-effort cleanup of the orphaned upload — leaving the file in
      // place would still be safe (storage RLS prevents anyone but the
      // student + teacher from reading it) but it's wasteful.
      await supabase.storage.from("homework-audio").remove([path]).catch((err) => {
        // Orphan-file leak; safe storage-wise (RLS prevents external read)
        // but accumulates wasted bytes. Warn for visibility, never throw.
        logWarn("audio cleanup of orphan upload failed", {
          tag: "follow-up", kind: "storage-cleanup", path,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      setStage("previewing");
      setErrorMsg(result.error);
      return;
    }

    onSubmitted?.();
  }

  async function handleSkip() {
    setSkipping(true);
    try {
      await onSkipAudio();
    } finally {
      setSkipping(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Mic size={12} aria-hidden="true" />
          {t("سجّل تلاوتك (اختياري)", "Record your recitation (optional)")}
        </p>
        <p className="text-[10px] text-muted-light">
          {t(`أقصى ${MAX_DURATION_SECONDS} ثانية`, `Up to ${MAX_DURATION_SECONDS}s`)}
        </p>
      </div>

      {errorMsg && (
        <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {stage === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleStartRecording}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/15 focus-ring"
          >
            <Mic size={12} aria-hidden="true" />
            {t("ابدأ التسجيل", "Start recording")}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={skipping}
            className="text-xs text-muted hover:text-foreground/80 focus-ring rounded px-1.5 py-1 disabled:opacity-50"
          >
            {skipping
              ? t("جارٍ الإرسال...", "Submitting...")
              : t("إرسال بدون تسجيل ←", "Submit without audio →")}
          </button>
        </div>
      )}

      {stage === "permission" && (
        <p className="text-xs text-muted">
          {t("بانتظار إذن الميكروفون...", "Waiting for microphone permission...")}
        </p>
      )}

      {stage === "recording" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-error" aria-hidden="true" />
          <span className="font-mono text-sm tabular-nums text-error">
            {formatTime(elapsed)} / {formatTime(MAX_DURATION_SECONDS)}
          </span>
          <button
            type="button"
            onClick={handleStopRecording}
            className="inline-flex items-center gap-1.5 rounded-full border border-error/30 bg-error/10 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/15 focus-ring"
          >
            <Square size={12} aria-hidden="true" />
            {t("أوقف التسجيل", "Stop")}
          </button>
        </div>
      )}

      {(stage === "previewing" || stage === "uploading") && audioUrl && (
        <div className="space-y-2">
          <audio src={audioUrl} controls className="w-full" preload="metadata" />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={stage === "uploading"}
              className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/15 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/25 disabled:opacity-50 focus-ring"
            >
              <Upload size={12} aria-hidden="true" />
              {stage === "uploading"
                ? t("جارٍ الرفع...", "Uploading...")
                : t("أرسل التسجيل", "Submit recording")}
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={stage === "uploading"}
              className="inline-flex items-center gap-1.5 rounded-full border border-card-border px-3 py-1.5 text-xs text-muted hover:bg-foreground/5 hover:text-foreground disabled:opacity-50 focus-ring"
            >
              <Trash2 size={12} aria-hidden="true" />
              {t("سجل من جديد", "Re-record")}
            </button>
          </div>
        </div>
      )}

      {stage === "error" && (
        <button
          type="button"
          onClick={() => { setStage("idle"); setErrorMsg(null); }}
          className="text-xs text-gold hover:text-gold-hover focus-ring rounded px-1.5 py-1"
        >
          {t("حاول مجدداً", "Try again")}
        </button>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
