"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Radio, User, GraduationCap, StopCircle, Eye } from "lucide-react";
import { SessionTimer } from "@/components/shared/session-timer";
import { forceEndSession } from "../actions";

interface ActiveSession {
  id: string;
  started_at: string;
  teacher_joined: boolean;
  student_joined: boolean;
  student_name: string;
  teacher_name: string;
  duration_min: number;
  scheduled_at: string;
}

function cardColor(s: ActiveSession): string {
  const bothJoined = s.teacher_joined && s.student_joined;
  const oneJoined = s.teacher_joined || s.student_joined;
  const elapsed = (Date.now() - new Date(s.started_at).getTime()) / 60000;
  const overtime = elapsed > s.duration_min;

  if (overtime) return "border-red-500/40 bg-red-500/5";
  if (bothJoined) return "border-emerald-500/40 bg-emerald-500/5";
  if (oneJoined) return "border-amber-500/40 bg-amber-500/5";
  return "border-card-border bg-card";
}

export function LiveSessionsMonitor({ sessions }: { sessions: ActiveSession[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /* Auto-refresh every 30s */
  useEffect(() => {
    const id = setInterval(() => {
      startTransition(() => router.refresh());
    }, 30_000);
    return () => clearInterval(id);
  }, [router, startTransition]);

  async function handleForceEnd(sessionId: string) {
    const reason = prompt("سبب إنهاء الجلسة:");
    if (!reason) return;
    const result = await forceEndSession(sessionId, reason);
    if (result.error) alert(result.error);
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-12 text-center">
        <Radio size={32} className="mx-auto mb-3 text-muted" />
        <p className="text-muted">لا توجد جلسات نشطة حالياً</p>
        <p className="mt-1 text-xs text-muted">No active sessions right now</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`relative rounded-2xl border p-5 transition-colors ${cardColor(s)}`}
        >
          {/* Header: Timer */}
          <div className="mb-4">
            <SessionTimer startedAt={s.started_at} durationMin={s.duration_min} />
          </div>

          {/* Student */}
          <div className="mb-2 flex items-center gap-2 text-sm">
            <User size={14} className="text-muted" />
            <span className="font-medium">{s.student_name}</span>
            <span
              className={`mr-auto rounded-full px-2 py-0.5 text-xs ${
                s.student_joined
                  ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border border-red-500/30 bg-red-500/10 text-red-400"
              }`}
            >
              {s.student_joined ? "متصل" : "غير متصل"}
            </span>
          </div>

          {/* Teacher */}
          <div className="mb-4 flex items-center gap-2 text-sm">
            <GraduationCap size={14} className="text-muted" />
            <span className="font-medium">{s.teacher_name}</span>
            <span
              className={`mr-auto rounded-full px-2 py-0.5 text-xs ${
                s.teacher_joined
                  ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border border-red-500/30 bg-red-500/10 text-red-400"
              }`}
            >
              {s.teacher_joined ? "متصل" : "غير متصل"}
            </span>
          </div>

          {/* Force End */}
          <button
            onClick={() => handleForceEnd(s.id)}
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            <StopCircle size={14} />
            إنهاء الجلسة
          </button>

          {/* Observe */}
          <Link
            href={`/admin/sessions/${s.id}/observe`}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/20"
          >
            <Eye size={14} /> مراقبة
          </Link>
        </div>
      ))}
    </div>
  );
}
