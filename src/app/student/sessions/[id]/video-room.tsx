"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Video, VideoOff, AlertCircle } from "lucide-react";
import { DeviceCheck } from "@/components/shared/device-check";
import { SessionTimer } from "@/components/shared/session-timer";
import { generateSessionToken, trackSessionEvent } from "./actions";

export function VideoRoom({
  sessionId,
  roomUrl,
  userName,
  expiresAt,
  scheduledAt,
  durationMin,
  startedAt,
}: {
  sessionId: string;
  roomUrl: string;
  userName: string;
  expiresAt: string | null;
  scheduledAt: string;
  durationMin: number;
  startedAt?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<ReturnType<
    typeof import("@daily-co/daily-js").default.createFrame
  > | null>(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [devicesReady, setDevicesReady] = useState(false);
  const [activeStartedAt, setActiveStartedAt] = useState(startedAt ?? null);

  const handleDeviceReady = useCallback((ok: boolean) => {
    setDevicesReady(ok);
  }, []);

  // Fix #5: Check if room is expired
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;

  // Fix #10: Time window enforcement — joinable 10 min before scheduled time
  const scheduled = new Date(scheduledAt);
  const windowStart = new Date(scheduled.getTime() - 10 * 60 * 1000);
  const windowEnd = new Date(
    scheduled.getTime() + (durationMin + 30) * 60 * 1000,
  );
  const now = new Date();
  const tooEarly = now < windowStart;
  const tooLate = now > windowEnd;
  const canJoin = !isExpired && !tooEarly && !tooLate;

  async function joinCall() {
    if (!containerRef.current || frameRef.current || loading) return;
    setLoading(true);
    setError(null);

    try {
      // Fix #1: Get a scoped meeting token from the server
      const result = await generateSessionToken(sessionId);
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }

      const DailyIframe = (await import("@daily-co/daily-js")).default;

      const frame = DailyIframe.createFrame(containerRef.current, {
        iframeStyle: {
          width: "100%",
          height: "100%",
          border: "0",
          borderRadius: "12px",
        },
        showLeaveButton: true,
        showFullscreenButton: true,
      });

      frameRef.current = frame;

      frame.on("joined-meeting", () => {
        setJoined(true);
        setLoading(false);
        // Set started_at for timer if not already set
        if (!activeStartedAt) {
          setActiveStartedAt(new Date().toISOString());
        }
        // Fix #7: Track join event
        trackSessionEvent(sessionId, "joined");
      });

      frame.on("left-meeting", () => {
        setJoined(false);
        frame.destroy();
        frameRef.current = null;
        // Fix #7: Track leave event
        trackSessionEvent(sessionId, "left");
      });

      frame.on("error", () => {
        setError("حدث خطأ في الاتصال — حاول مرة أخرى");
        setJoined(false);
        setLoading(false);
      });

      // Join with token instead of raw URL
      await frame.join({ url: roomUrl, token: result.token, userName });
    } catch {
      setError("تعذر الانضمام للجلسة — تأكد من اتصالك بالإنترنت");
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        frameRef.current.destroy();
        frameRef.current = null;
      }
    };
  }, []);

  // Show appropriate message for expired/time-window issues
  if (isExpired) {
    return (
      <div className="rounded-2xl border border-error/30 bg-error/10 p-8 text-center">
        <AlertCircle size={32} className="mx-auto mb-3 text-error" />
        <p className="font-semibold text-error">انتهت صلاحية غرفة الجلسة</p>
        <p className="mt-1 text-sm text-muted">
          يرجى التواصل مع المعلم لإعادة جدولة الجلسة
        </p>
      </div>
    );
  }

  if (tooEarly) {
    const minsUntil = Math.ceil(
      (windowStart.getTime() - Date.now()) / 60000,
    );
    return (
      <div className="rounded-2xl border border-gold/30 bg-gold/5 p-8 text-center">
        <Video size={32} className="mx-auto mb-3 text-gold" />
        <p className="font-semibold text-gold">الجلسة لم تبدأ بعد</p>
        <p className="mt-1 text-sm text-muted">
          يمكنك الانضمام قبل الموعد بـ ١٠ دقائق — متبقي{" "}
          {minsUntil > 60
            ? `${Math.floor(minsUntil / 60)} ساعة و ${minsUntil % 60} دقيقة`
            : `${minsUntil} دقيقة`}
        </p>
      </div>
    );
  }

  if (tooLate) {
    return (
      <div className="rounded-2xl border border-error/30 bg-error/10 p-8 text-center">
        <AlertCircle size={32} className="mx-auto mb-3 text-error" />
        <p className="font-semibold text-error">انتهى وقت الجلسة</p>
        <p className="mt-1 text-sm text-muted">
          تجاوز الوقت المحدد للجلسة
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {!joined && !loading && (
        <div className="rounded-2xl border border-card-border bg-card elevation-2 p-12 text-center">
          <Video size={40} className="mx-auto mb-4 text-gold" />
          <h2 className="mb-2 text-xl font-bold">غرفة الجلسة جاهزة</h2>
          <p className="mb-6 text-sm text-muted">
            اضغط للانضمام إلى جلسة الفيديو مع معلمك
          </p>
          <div className="mx-auto mb-6 max-w-sm">
            <DeviceCheck onReady={handleDeviceReady} />
          </div>
          <button
            onClick={joinCall}
            disabled={!canJoin || !devicesReady}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 text-lg font-semibold text-white neu-btn transition-colors hover:bg-primary-hover focus-ring disabled:opacity-50"
          >
            <Video size={20} />
            انضم للجلسة
          </button>
        </div>
      )}

      {loading && !joined && (
        <div className="rounded-2xl border border-card-border bg-card elevation-2 p-12 text-center">
          <span className="mx-auto mb-4 block h-8 w-8 animate-spin rounded-full border-4 border-gold/30 border-t-gold" />
          <p className="text-sm text-muted">جاري الاتصال...</p>
        </div>
      )}

      {/* Video container — always in DOM, hidden until joined */}
      <div
        ref={containerRef}
        className={`overflow-hidden rounded-xl ${joined ? "aspect-video" : "h-0"}`}
      />

      {joined && (
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-card-border bg-card elevation-2 p-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-success">
              <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
              الجلسة جارية
            </div>
            {activeStartedAt && (
              <SessionTimer startedAt={activeStartedAt} durationMin={durationMin} />
            )}
          </div>
          <button
            onClick={() => frameRef.current?.leave()}
            className="flex items-center gap-1.5 rounded-lg border border-error/30 px-3 py-1.5 text-xs text-error transition-colors hover:bg-error/10 focus-ring"
          >
            <VideoOff size={14} />
            مغادرة
          </button>
        </div>
      )}
    </div>
  );
}
