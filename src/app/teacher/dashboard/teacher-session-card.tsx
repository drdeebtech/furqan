"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Video,
  PhoneOff,
  UserX,
  TimerReset,
  PlusCircle,
  Save,
  CheckCircle,
  Loader2,
  StickyNote,
} from "lucide-react";
import { SessionStatus } from "@/components/shared/session-status";
import { SessionTimer } from "@/components/shared/session-timer";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { useLang } from "@/lib/i18n/context";
import type { SessionType } from "@/types/database";

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};
import {
  endSession,
  markNoShow,
  extendSessionRoom,
  recreateRoom,
  saveQuickNotes,
} from "./actions";

interface TeacherSessionCardProps {
  sessionId: string | null;
  bookingId: string;
  studentName: string;
  sessionType: SessionType;
  scheduledAt: string;
  durationMin: number;
  roomUrl: string | null;
  expiresAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export function TeacherSessionCard({
  sessionId,
  bookingId,
  studentName,
  sessionType,
  scheduledAt,
  durationMin,
  roomUrl,
  expiresAt,
  startedAt,
  endedAt,
}: TeacherSessionCardProps) {
  const { lang } = useLang();
  const locale = lang === "ar" ? "ar" : "en-US";
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [currentRoomUrl, setCurrentRoomUrl] = useState(roomUrl);
  const [currentExpiresAt, setCurrentExpiresAt] = useState(expiresAt);
  const [isEnded, setIsEnded] = useState(!!endedAt);

  const [now] = useState(() => Date.now());
  const expiresMs = currentExpiresAt
    ? new Date(currentExpiresAt).getTime()
    : null;
  const isExpired = expiresMs !== null && expiresMs < now;
  const isAboutToExpire =
    expiresMs !== null && !isExpired && expiresMs - now < 15 * 60 * 1000;

  const isLive = !isEnded && !isExpired && startedAt !== null;
  const scheduledMs = new Date(scheduledAt).getTime();
  const inWindow =
    !isEnded &&
    !isExpired &&
    now >= scheduledMs - 10 * 60 * 1000 &&
    now < scheduledMs + (durationMin + 30) * 60 * 1000;

  async function handleEndSession() {
    if (!sessionId) return;
    setLoading("end");
    setError(null);
    const result = await endSession(sessionId);
    if (result.error) setError(result.error);
    else {
      setSuccess("تم إنهاء الجلسة");
      setIsEnded(true);
    }
    setLoading(null);
  }

  async function handleMarkNoShow() {
    setLoading("noshow");
    setError(null);
    const result = await markNoShow(bookingId);
    if (result.error) setError(result.error);
    else {
      setSuccess("تم تسجيل الغياب");
      setIsEnded(true);
    }
    setLoading(null);
  }

  async function handleExtendRoom() {
    if (!sessionId) return;
    setLoading("extend");
    setError(null);
    const result = await extendSessionRoom(sessionId);
    if (result.error) setError(result.error);
    else {
      setSuccess("تم تمديد الغرفة");
      if (result.newExpiresAt) setCurrentExpiresAt(result.newExpiresAt);
      setTimeout(() => setSuccess(null), 3000);
    }
    setLoading(null);
  }

  async function handleRecreateRoom() {
    setLoading("recreate");
    setError(null);
    const result = await recreateRoom(bookingId);
    if (result.error) setError(result.error);
    else {
      setSuccess("تم إنشاء غرفة جديدة");
      if (result.roomUrl) setCurrentRoomUrl(result.roomUrl);
      setTimeout(() => setSuccess(null), 3000);
    }
    setLoading(null);
  }

  async function handleSaveNotes() {
    if (!sessionId) return;
    setLoading("notes");
    const result = await saveQuickNotes(sessionId, notes);
    if (result.error) setError(result.error);
    else {
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 3000);
    }
    setLoading(null);
  }

  const spinner = <Loader2 size={14} className="animate-spin" />;

  return (
    <div className="glass-card border-gold/20 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{studentName}</p>
            <SessionStatus
              scheduledAt={scheduledAt}
              durationMin={durationMin}
              expiresAt={currentExpiresAt}
              endedAt={isEnded ? (endedAt ?? new Date().toISOString()) : null}
            />
          </div>
          <p className="mt-1 text-sm text-gold">
            {lang === "ar" ? SESSION_TYPE_AR[sessionType] : SESSION_TYPE_EN[sessionType]} · {durationMin} {lang === "ar" ? "دقيقة" : "min"}
          </p>
          <p dir="ltr" className="mt-1 text-start text-sm text-muted">
            {new Date(scheduledAt).toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        {/* Timer (when live) */}
        {isLive && startedAt && (
          <SessionTimer startedAt={startedAt} durationMin={durationMin} />
        )}
      </div>

      {/* Error / Success messages */}
      {error && (
        <div className="mt-3 rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-400">
          {success}
        </div>
      )}

      {/* Action buttons */}
      {!isEnded && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* Join button */}
          {currentRoomUrl && sessionId && (inWindow || isLive) && (
            <Link
              href={`/teacher/sessions/${sessionId}`}
              className="glass-success glass-pill inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-green-700 sm:px-3 sm:py-1.5"
            >
              <Video size={14} />
              انضم للجلسة
            </Link>
          )}

          {/* End Session */}
          {sessionId && (inWindow || isLive) && (
            <button
              onClick={handleEndSession}
              disabled={loading !== null}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-500/30 px-4 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50 sm:px-3 sm:py-1.5"
            >
              {loading === "end" ? spinner : <PhoneOff size={14} />}
              إنهاء الجلسة
            </button>
          )}

          {/* Mark No-Show */}
          <button
            onClick={handleMarkNoShow}
            disabled={loading !== null}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-500/30 px-4 py-2 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50 sm:px-3 sm:py-1.5"
          >
            {loading === "noshow" ? spinner : <UserX size={14} />}
            لم يحضر
          </button>

          {/* Extend Room */}
          {sessionId && isAboutToExpire && (
            <button
              onClick={handleExtendRoom}
              disabled={loading !== null}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gold/30 px-4 py-2 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50 sm:px-3 sm:py-1.5"
            >
              {loading === "extend" ? spinner : <TimerReset size={14} />}
              تمديد الغرفة
            </button>
          )}

          {/* Recreate Room */}
          {(isExpired || !currentRoomUrl) && (
            <button
              onClick={handleRecreateRoom}
              disabled={loading !== null}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gold/30 px-4 py-2 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50 sm:px-3 sm:py-1.5"
            >
              {loading === "recreate" ? (
                spinner
              ) : (
                <PlusCircle size={14} />
              )}
              إنشاء غرفة جديدة
            </button>
          )}
        </div>
      )}

      {/* Quick notes */}
      {sessionId && (
        <div className="mt-4">
          {!showNotes ? (
            <button
              onClick={() => setShowNotes(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
            >
              <StickyNote size={14} />
              ملاحظات سريعة
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="glass-input w-full resize-none px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                placeholder="أضف ملاحظات سريعة عن الجلسة..."
              />
              <button
                onClick={handleSaveNotes}
                disabled={loading === "notes" || !notes.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
              >
                {loading === "notes" ? (
                  spinner
                ) : notesSaved ? (
                  <CheckCircle size={14} />
                ) : (
                  <Save size={14} />
                )}
                {notesSaved ? "تم الحفظ" : "حفظ"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
