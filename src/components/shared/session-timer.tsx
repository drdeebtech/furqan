"use client";

import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function SessionTimer({
  startedAt,
  durationMin,
  onHalfway,
  onFinished,
}: {
  startedAt: string;
  durationMin: number;
  onHalfway?: () => void;
  onFinished?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const halfwayFiredRef = useRef(false);
  const finishedFiredRef = useRef(false);

  useEffect(() => {
    const startMs = new Date(startedAt).getTime();
    const tick = () => setElapsed(Date.now() - startMs);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const scheduled = durationMin * 60 * 1000;
  const overtime = elapsed > scheduled;

  // Fire-once milestones. Refs (not state) prevent re-fires across renders;
  // we deliberately don't reset on prop change because a session's duration
  // is fixed once it starts.
  useEffect(() => {
    if (!halfwayFiredRef.current && elapsed >= scheduled / 2 && elapsed < scheduled) {
      halfwayFiredRef.current = true;
      onHalfway?.();
    }
    if (!finishedFiredRef.current && elapsed >= scheduled) {
      finishedFiredRef.current = true;
      // If we cross the finish line, the halfway event is no longer useful.
      halfwayFiredRef.current = true;
      onFinished?.();
    }
  }, [elapsed, scheduled, onHalfway, onFinished]);

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-mono font-semibold transition-colors ${
        overtime
          ? "glass glass-danger text-error"
          : "glass glass-gold text-gold"
      }`}
    >
      <Timer size={14} className={overtime ? "animate-pulse" : ""} />
      {formatElapsed(elapsed)}
      <span className="text-xs font-normal text-muted">
        / {durationMin}:00
      </span>
    </div>
  );
}
