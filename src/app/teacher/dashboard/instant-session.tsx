"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { startInstantSession } from "./actions";

interface Student {
  id: string;
  name: string;
}

export function InstantSessionButton({ students }: { students: Student[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [duration, setDuration] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    if (!selectedStudent) return;
    setLoading(true);
    setError(null);
    const result = await startInstantSession(selectedStudent, duration);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    if (result.sessionId) {
      router.push(`/teacher/sessions/${result.sessionId}`);
    } else {
      setLoading(false);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
      >
        <Zap size={16} />
        جلسة فورية
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-gold/30 bg-card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <Zap size={16} className="text-green-400" />
        بدء جلسة فورية
      </h3>

      {error && (
        <div className="mb-3 rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label htmlFor="instant-student" className="mb-1 block text-xs text-muted">اختر الطالب</label>
          <select
            id="instant-student"
            name="instant-student"
            value={selectedStudent}
            onChange={(e) => setSelectedStudent(e.target.value)}
            className="w-full rounded-lg border border-input-border bg-input px-3 py-2 text-sm focus:border-gold focus:outline-none"
          >
            <option value="">— اختر طالباً —</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">المدة</label>
          <div className="flex gap-2">
            {[30, 45, 60].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                  duration === d
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-input-border text-muted hover:border-gold/50"
                }`}
              >
                {d} د
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={!selectedStudent || loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                <Zap size={14} />
                ابدأ الآن
              </>
            )}
          </button>
          <button
            onClick={() => { setOpen(false); setError(null); }}
            className="rounded-lg border border-card-border px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
