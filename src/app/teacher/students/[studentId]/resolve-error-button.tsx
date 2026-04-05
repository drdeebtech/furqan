"use client";

import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { resolveRecitationError } from "./actions";

export function ResolveErrorButton({ errorId }: { errorId: string }) {
  const [resolved, setResolved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleResolve() {
    setLoading(true);
    await resolveRecitationError(errorId);
    setResolved(true);
    setLoading(false);
  }

  if (resolved) {
    return <span className="text-xs text-green-400">تم الحل ✓</span>;
  }

  return (
    <button
      onClick={handleResolve}
      disabled={loading}
      className="mr-auto flex shrink-0 items-center gap-1 rounded border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-400 transition-colors hover:bg-green-500/20 disabled:opacity-50"
    >
      <CheckCircle size={12} />
      {loading ? "..." : "تم الحل"}
    </button>
  );
}
