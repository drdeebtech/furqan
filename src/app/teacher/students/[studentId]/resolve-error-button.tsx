"use client";

import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { resolveRecitationError } from "./actions";

export function ResolveErrorButton({ errorId }: { errorId: string }) {
  const [resolved, setResolved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve() {
    setLoading(true);
    setError(null);
    const result = await resolveRecitationError(errorId);
    if (result.error) {
      setError(result.error);
    } else {
      setResolved(true);
    }
    setLoading(false);
  }

  if (resolved) {
    return <span className="text-xs text-green-400">تم الحل</span>;
  }

  return (
    <div className="mr-auto flex shrink-0 items-center gap-1.5">
      {error && <span className="text-xs text-error">{error}</span>}
      <button
        onClick={handleResolve}
        disabled={loading}
        className="glass-success glass-badge flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs text-green-400 transition-colors hover:bg-green-500/20 disabled:opacity-50"
      >
        {loading ? (
          <span className="block h-3 w-3 animate-spin rounded-full border-2 border-green-400/30 border-t-green-400" />
        ) : (
          <CheckCircle size={12} />
        )}
        تم الحل
      </button>
    </div>
  );
}
