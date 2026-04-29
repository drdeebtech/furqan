"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Loader2, AlertCircle } from "lucide-react";
import { upsertLessonProgress } from "@/lib/actions/course-playback";

interface Props {
  lessonId: string;
  initialPositionSeconds: number;
  signedUrl: string;
  errorLabel: string;
  loadingLabel: string;
}

const PROGRESS_INTERVAL_MS = 15_000;

export function LessonPlayer({
  lessonId,
  initialPositionSeconds,
  signedUrl,
  errorLabel,
  loadingLabel,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(signedUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        if (initialPositionSeconds > 0) {
          video.currentTime = initialPositionSeconds;
        }
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) setError(errorLabel);
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS (Safari)
      video.src = signedUrl;
      video.addEventListener("loadedmetadata", () => {
        setLoading(false);
        if (initialPositionSeconds > 0) {
          video.currentTime = initialPositionSeconds;
        }
      });
    } else {
      setError(errorLabel);
    }

    return () => {
      hls?.destroy();
    };
  }, [signedUrl, initialPositionSeconds, errorLabel]);

  // Periodic progress save
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const save = () => {
      if (!video.duration || isNaN(video.duration)) return;
      void upsertLessonProgress(lessonId, video.currentTime, video.duration);
    };

    const id = window.setInterval(save, PROGRESS_INTERVAL_MS);
    const onPause = () => save();
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", save);
    return () => {
      window.clearInterval(id);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", save);
      save();
    };
  }, [lessonId]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 text-white">
          <Loader2 size={28} className="animate-spin" />
          <span className="ms-2 text-sm">{loadingLabel}</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80 text-white">
          <AlertCircle size={28} />
          <span className="text-sm">{error}</span>
        </div>
      )}
      <video
        ref={videoRef}
        controls
        playsInline
        className="h-full w-full"
        // poster could be set from course.cover_image_url
      />
    </div>
  );
}
