"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Mic, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

type DeviceState = "checking" | "granted" | "denied" | "error";

function StatusIcon({ state }: { state: DeviceState }) {
  return state === "checking" ? (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
  ) : state === "granted" ? (
    <CheckCircle size={16} className="text-success" />
  ) : (
    <XCircle size={16} className="text-red-400" />
  );
}

export function DeviceCheck({ onReady }: { onReady?: (ok: boolean) => void }) {
  const { t } = useLang();
  const [camera, setCamera] = useState<DeviceState>("checking");
  const [mic, setMic] = useState<DeviceState>("checking");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Check camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCamera("granted");
      } catch {
        if (!cancelled) setCamera("denied");
      }

      // Check mic
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        stream.getTracks().forEach((t) => t.stop());
        setMic("granted");
      } catch {
        if (!cancelled) setMic("denied");
      }
    }

    check();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (camera !== "checking" && mic !== "checking") {
      onReady?.(camera === "granted" && mic === "granted");
    }
  }, [camera, mic, onReady]);

  const allDenied = camera === "denied" && mic === "denied";

  return (
    <div className="glass-card rounded-xl p-4">
      <p className="mb-3 text-sm font-medium">فحص الأجهزة قبل الانضمام</p>

      {/* Camera preview */}
      <div className="mb-3 overflow-hidden rounded-lg bg-background">
        {camera === "granted" ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label={t("معاينة الكاميرا", "Camera preview")}
            className="h-32 w-full object-cover"
          />
        ) : (
          <div className="flex h-32 items-center justify-center">
            <Camera size={24} className="text-muted" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Camera size={14} className="text-muted" />
          <span>الكاميرا</span>
          <StatusIcon state={camera} />
          {camera === "denied" && (
            <span className="text-xs text-red-400">غير مسموح</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Mic size={14} className="text-muted" />
          <span>الميكروفون</span>
          <StatusIcon state={mic} />
          {mic === "denied" && (
            <span className="text-xs text-red-400">غير مسموح</span>
          )}
        </div>
      </div>

      {allDenied && (
        <div className="mt-3 flex items-start gap-2 rounded-lg glass glass-danger p-2 text-xs text-red-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          يرجى السماح بالوصول للكاميرا والميكروفون من إعدادات المتصفح
        </div>
      )}
    </div>
  );
}
