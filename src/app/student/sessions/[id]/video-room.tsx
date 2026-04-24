"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Video, VideoOff, AlertCircle, Maximize2 } from "lucide-react";
import { DeviceCheck } from "@/components/shared/device-check";
import { SessionTimer } from "@/components/shared/session-timer";
import { useLang } from "@/lib/i18n/context";
import { generateSessionToken, trackSessionEvent } from "./actions";

export function VideoRoom({
  sessionId,
  roomUrl,
  userName,
  expiresAt,
  durationMin,
  startedAt,
}: {
  sessionId: string;
  roomUrl: string;
  userName: string;
  expiresAt: string | null;
  durationMin: number;
  startedAt?: string | null;
}) {
  const { t } = useLang();
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<ReturnType<
    typeof import("@daily-co/daily-js").default.createFrame
  > | null>(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [devicesReady, setDevicesReady] = useState(false);
  const [activeStartedAt, setActiveStartedAt] = useState(startedAt ?? null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleDeviceReady = useCallback((ok: boolean) => {
    setDevicesReady(ok);
  }, []);

  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  const canJoin = !isExpired;

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    }
  }

  async function joinCall() {
    if (!containerRef.current || frameRef.current || loading) return;
    setLoading(true);
    setError(null);

    try {
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
        showLocalVideo: true,
        showParticipantsBar: true,
      });

      frameRef.current = frame;

      const joinTimeout = setTimeout(() => {
        if (!frameRef.current) return;
        setError("انتهت مهلة الاتصال — حاول مرة أخرى");
        setLoading(false);
        try { frame.destroy(); } catch { /* ignore */ }
        frameRef.current = null;
      }, 30000);

      frame.on("joined-meeting", () => {
        clearTimeout(joinTimeout);
        setJoined(true);
        setLoading(false);
        if (!activeStartedAt) {
          setActiveStartedAt(new Date().toISOString());
        }
        trackSessionEvent(sessionId, "joined");
      });

      frame.on("left-meeting", () => {
        setJoined(false);
        frame.destroy();
        frameRef.current = null;
        if (document.fullscreenElement) document.exitFullscreen();
        setIsFullscreen(false);
        trackSessionEvent(sessionId, "left");
      });

      frame.on("error", () => {
        clearTimeout(joinTimeout);
        setError("حدث خطأ في الاتصال — حاول مرة أخرى");
        setJoined(false);
        setLoading(false);
      });

      await frame.join({ url: roomUrl, token: result.token, userName });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(`تعذر الانضمام للجلسة — ${msg || "تأكد من اتصالك بالإنترنت"}`);
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

  // Listen for fullscreen changes
  useEffect(() => {
    function handleFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  if (isExpired) {
    return (
      <div className="rounded-2xl border border-error/30 bg-error/10 p-8 text-center">
        <AlertCircle size={32} className="mx-auto mb-3 text-error" />
        <p className="font-semibold text-error">انتهت صلاحية غرفة الجلسة</p>
        <p className="mt-1 text-sm text-muted">يرجى التواصل مع المعلم لإعادة جدولة الجلسة</p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}

      {!joined && !loading && (
        <div className="glass-card p-8 text-center md:p-12">
          <Video size={40} className="mx-auto mb-4 text-gold" />
          <h2 className="mb-2 font-display text-xl font-bold">غرفة الجلسة جاهزة</h2>
          <p className="mb-6 text-sm text-muted">اضغط للانضمام إلى جلسة الفيديو</p>
          <div className="mx-auto mb-6 max-w-sm">
            <DeviceCheck onReady={handleDeviceReady} />
          </div>
          <button
            onClick={joinCall}
            disabled={!canJoin || !devicesReady}
            className="inline-flex items-center gap-2 glass-gold glass-pill px-8 py-3 text-lg font-semibold text-white transition-colors focus-ring disabled:opacity-50"
          >
            <Video size={20} />
            انضم للجلسة
          </button>
        </div>
      )}

      {loading && !joined && (
        <div className="py-4 text-center">
          <span className="mx-auto mb-2 block h-6 w-6 animate-spin rounded-full border-4 border-gold/30 border-t-gold" />
          <p className="text-xs text-muted">جاري الاتصال...</p>
        </div>
      )}

      {/* Video container — full height for both loading (Daily pre-join) and active call */}
      <div
        ref={containerRef}
        className={`overflow-hidden rounded-xl bg-black ${!joined && !loading ? "hidden" : ""}`}
        style={{
          height: "calc(100vh - 200px)",
          minHeight: "400px",
        }}
      />

      {/* Session controls bar */}
      {joined && (
        <div className="mt-2 flex items-center justify-between glass-card p-2 md:mt-4 md:p-3">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex items-center gap-1.5 text-xs text-success md:text-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
              <span className="hidden sm:inline">الجلسة جارية</span>
            </div>
            {activeStartedAt && (
              <SessionTimer startedAt={activeStartedAt} durationMin={durationMin} />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1 rounded-lg glass px-2 py-1.5 text-xs text-muted transition-colors hover:text-gold md:px-3"
              title={t("ملء الشاشة", "Fullscreen")}
              aria-label={t("ملء الشاشة", "Fullscreen")}
            >
              <Maximize2 size={14} />
              <span className="hidden sm:inline">{isFullscreen ? t("تصغير", "Exit") : t("ملء الشاشة", "Fullscreen")}</span>
            </button>
            <button
              onClick={() => frameRef.current?.leave()}
              className="flex items-center gap-1.5 rounded-lg border border-error/30 px-2 py-1.5 text-xs text-error transition-colors hover:bg-error/10 focus-ring md:px-3"
              aria-label={t("مغادرة", "Leave")}
            >
              <VideoOff size={14} />
              <span className="hidden sm:inline">{t("مغادرة", "Leave")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
