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
  // The End button shows whenever the session isn't already ended, so a
  // teacher can manually close out a session that wasn't joined or that's
  // outside its active window. The Timer + Extend stay gated on isActive
  // since they only make sense inside the window.
  const canEnd = !ended;

  async function handleEnd() {
    // Always confirm — End is destructive (deducts a package session, fires
    // events, marks the booking complete). One click without confirmation
    // is a fat-finger waiting to happen even during an active session.
    // The phrasing differs slightly between in-window vs out-of-window so
    // the teacher knows which case they're in.
    const message = isActive
      ? "هل أنت متأكد من إنهاء هذه الجلسة الآن؟"
      : "هذه الجلسة ليست في وقتها النشط. هل تريد إنهاءها يدوياً؟";
    if (!window.confirm(message)) return;
    setLoading("end");
    setError(null);
    const result = await endSession({ sessionId });
    if (!result.ok) setError(result.error);
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
      <div className="glass-success glass-card mb-6 p-4 text-center text-sm text-success">
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
        {canEnd && (
          <button
            onClick={handleEnd}
            disabled={loading !== null}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              isActive
                ? "border border-error/30 text-red-400 hover:bg-error/10"
                : "border border-surface-border text-muted hover:border-error/30 hover:text-red-400"
            }`}
            title={isActive ? "" : "إنهاء يدوي خارج وقت الجلسة"}
          >
            {loading === "end" ? spinner : <PhoneOff size={14} />}
            إنهاء الجلسة
          </button>
        )}

        {/* Extend button: previously only appeared in the last 15 min before
            expiry. That meant a teacher who missed the window had no recovery
            path — the room would expire silently. Now we render whenever the
            session is active AND the room hasn't expired yet, with a stronger
            visual when the 15-min warning kicks in. */}
        {isActive && expiresMs !== null && expiresMs > now && (
          <button
            onClick={handleExtend}
            disabled={loading !== null}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              isAboutToExpire
                ? "border border-gold/30 text-gold hover:bg-gold/10"
                : "border border-surface-border text-muted hover:border-gold/30 hover:text-gold"
            }`}
            title={isAboutToExpire ? "تنتهي صلاحية الغرفة قريباً" : "تمديد إضافي للغرفة"}
          >
            {loading === "extend" ? spinner : <TimerReset size={14} />}
            {extendSuccess ? "تم التمديد" : "تمديد الغرفة"}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" aria-atomic="true" className="w-full rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}
    </div>
  );
}
