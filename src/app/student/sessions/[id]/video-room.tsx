"use client";

import { useEffect, useRef, useState } from "react";
import { Video, VideoOff } from "lucide-react";

export function VideoRoom({
  roomUrl,
  userName,
}: {
  roomUrl: string;
  userName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<ReturnType<typeof import("@daily-co/daily-js").default.createFrame> | null>(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function joinCall() {
    if (!containerRef.current || frameRef.current) return;

    try {
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

      frame.on("joined-meeting", () => setJoined(true));
      frame.on("left-meeting", () => {
        setJoined(false);
        frame.destroy();
        frameRef.current = null;
      });
      frame.on("error", () => {
        setError("حدث خطأ في الاتصال — حاول مرة أخرى");
        setJoined(false);
      });

      await frame.join({ url: roomUrl, userName });
    } catch {
      setError("تعذر الانضمام للجلسة — تأكد من اتصالك بالإنترنت");
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

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {!joined && (
        <div className="rounded-2xl border border-card-border bg-card elevation-2 p-12 text-center">
          <Video size={40} className="mx-auto mb-4 text-gold" />
          <h2 className="mb-2 text-xl font-bold">غرفة الجلسة جاهزة</h2>
          <p className="mb-6 text-sm text-muted">
            اضغط للانضمام إلى جلسة الفيديو مع معلمك
          </p>
          <button
            onClick={joinCall}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 text-lg font-semibold text-white neu-btn transition-colors hover:bg-primary-hover focus-ring"
          >
            <Video size={20} />
            انضم للجلسة
          </button>
          <p className="mt-3 text-xs text-muted">
            سيطلب المتصفح إذن الكاميرا والميكروفون
          </p>
        </div>
      )}

      {/* Video container — always in DOM, hidden until joined */}
      <div
        ref={containerRef}
        className={`overflow-hidden rounded-xl ${joined ? "aspect-video" : "h-0"}`}
      />

      {joined && (
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-card-border bg-card elevation-2 p-3">
          <div className="flex items-center gap-2 text-sm text-success">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            الجلسة جارية
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
