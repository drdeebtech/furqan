"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { joinAsObserver } from "../../actions";

export function ObserverRoom({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<ReturnType<typeof import("@daily-co/daily-js").default.createFrame> | null>(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startObserving() {
    if (!containerRef.current || frameRef.current || loading) return;
    setLoading(true);
    setError(null);

    try {
      const result = await joinAsObserver(sessionId);
      if (result.error) { setError(result.error); setLoading(false); return; }

      const DailyIframe = (await import("@daily-co/daily-js")).default;
      const frame = DailyIframe.createFrame(containerRef.current, {
        iframeStyle: { width: "100%", height: "100%", border: "0", borderRadius: "12px" },
        showLeaveButton: true,
        showFullscreenButton: true,
      });

      frameRef.current = frame;

      frame.on("joined-meeting", () => { setJoined(true); setLoading(false); });
      frame.on("left-meeting", () => { setJoined(false); frame.destroy(); frameRef.current = null; });
      frame.on("error", () => { setError("حدث خطأ في الاتصال"); setJoined(false); setLoading(false); });

      // Join with mic/camera off
      await frame.join({
        url: result.roomUrl!,
        token: result.token!,
        userName: "مراقب",
        startVideoOff: true,
        startAudioOff: true,
      });
    } catch {
      setError("تعذر الانضمام كمراقب");
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => { if (frameRef.current) { frameRef.current.destroy(); frameRef.current = null; } };
  }, []);

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}

      {!joined && !loading && (
        <div className="glass-card p-12 text-center">
          <Eye size={40} className="mx-auto mb-4 text-gold" />
          <h2 className="mb-2 text-xl font-bold">مراقبة الجلسة</h2>
          <p className="mb-6 text-sm text-muted">ستنضم كمراقب بدون صوت أو كاميرا</p>
          <button onClick={startObserving} className="inline-flex items-center gap-2 glass-gold glass-pill px-8 py-3 text-lg font-semibold transition-colors focus-ring">
            <Eye size={20} /> بدء المراقبة
          </button>
        </div>
      )}

      {loading && !joined && (
        <div className="glass-card p-12 text-center">
          <span className="mx-auto mb-4 block h-8 w-8 animate-spin rounded-full border-4 border-gold/30 border-t-gold" />
          <p className="text-sm text-muted">جاري الاتصال...</p>
        </div>
      )}

      <div ref={containerRef} className={`overflow-hidden rounded-xl ${joined ? "aspect-video" : "h-0"}`} />

      {joined && (
        <div className="mt-4 flex items-center justify-between glass-card p-3">
          <div className="flex items-center gap-2 text-sm text-amber-400">
            <Eye size={14} />
            وضع المراقبة — الصوت والكاميرا مغلقان
          </div>
          <button onClick={() => frameRef.current?.leave()} className="flex items-center gap-1.5 rounded-lg border border-error/30 px-3 py-1.5 text-xs text-error transition-colors hover:bg-error/10 focus-ring">
            <EyeOff size={14} /> مغادرة
          </button>
        </div>
      )}
    </div>
  );
}
