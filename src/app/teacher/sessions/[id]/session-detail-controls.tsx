"use client";

import { useState } from "react";
import { PhoneOff, TimerReset, Loader2 } from "lucide-react";
import { SessionTimer } from "@/components/shared/session-timer";
import { endSession, extendSessionRoom } from "@/app/teacher/dashboard/actions";

interface Props {
  sessionId: string;
  startedAt: string | null;
  expiresAt: string | null;
  durationMin: number;
  scheduledAt: string;
}

export function SessionDetailControls({
  sessionId,
  startedAt,
  expiresAt,
  durationMin,
  scheduledAt,
}: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [currentExpiresAt, setCurrentExpiresAt] = useState(expiresAt);
  const [extendSuccess, setExtendSuccess] = useState(false);

  const [now] = useState(() => Date.now());
  const expiresMs = currentExpiresAt
    ? new Date(currentExpiresAt).getTime()
    : null;
  const isAboutToExpire =
    expiresMs !== null && expiresMs > now && expiresMs - now < 15 * 60 * 1000;

  const scheduledMs = new Date(scheduledAt).getTime();
  const isActive =
    !ended &&
    now >= scheduledMs - 10 * 60 * 1000 &&
    now < scheduledMs + (durationMin + 30) * 60 * 1000;

  async function handleEnd() {
    setLoading("end");
    setError(null);
    const result = await endSession(sessionId);
    if (result.error) setError(result.error);
    else setEnded(true);
    setLoading(null);
  }

  async function handleExtend() {
    setLoading("extend");
    setError(null);
    const result = await extendSessionRoom(sessionId);
    if (result.error) setError(result.error);
    else {
      if (result.newExpiresAt) setCurrentExpiresAt(result.newExpiresAt);
      setExtendSuccess(true);
      setTimeout(() => setExtendSuccess(false), 3000);
    }
    setLoading(null);
  }

  if (ended) {
    return (
      <div className="glass-success glass-card mb-6 p-4 text-center text-sm text-emerald-400">
        تم إنهاء الجلسة بنجاح
      </div>
    );
  }

  const spinner = <Loader2 size={14} className="animate-spin" />;

  return (
    <div className="glass-card mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
      {/* Timer */}
      <div className="flex items-center gap-3">
        {isActive && startedAt && (
          <SessionTimer startedAt={startedAt} durationMin={durationMin} />
        )}
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-2">
        {isActive && (
          <button
            onClick={handleEnd}
            disabled={loading !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            {loading === "end" ? spinner : <PhoneOff size={14} />}
            إنهاء الجلسة
          </button>
        )}

        {isAboutToExpire && (
          <button
            onClick={handleExtend}
            disabled={loading !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
          >
            {loading === "extend" ? spinner : <TimerReset size={14} />}
            {extendSuccess ? "تم التمديد" : "تمديد الغرفة"}
          </button>
        )}
      </div>

      {error && (
        <div className="w-full rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}
    </div>
  );
}
