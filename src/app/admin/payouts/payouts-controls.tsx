"use client";

// Spec 040 Phase 4 — interactive controls for /admin/payouts.
// Thin forms over the admin server actions; every mutation refreshes the
// server snapshot (router.refresh) so the table always shows DB truth.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  exportManualDueCsv,
  liftPayoutHold,
  placePayoutHold,
  requeueFailedEntry,
  setPayoutMethod,
  settleManualDueEntry,
  type PayoutAdminResult,
} from "@/lib/actions/admin/payouts";

function useAct() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<PayoutAdminResult>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg(res.note ?? "done");
        router.refresh();
      } else {
        // A refusal may carry a note (e.g. stale_net's fresh amount) — show it,
        // and refresh so fenced state (net due) re-renders from DB truth.
        setMsg(`error: ${res.error}${res.note ? ` — ${res.note}` : ""}`);
        if (res.error === "stale_net") router.refresh();
      }
    });
  return { pending, msg, run };
}

// min-h-11 = 44px minimum touch target (coding guidelines).
const inputCls =
  "min-h-11 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";
const btnCls =
  "min-h-11 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";

export function PlaceHoldForm({ teacherId, label }: { teacherId: string; label: string }) {
  const { pending, msg, run } = useAct();
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => placePayoutHold({ teacherId, reason }));
      }}
    >
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={label}
        aria-label={label}
        className={inputCls}
        maxLength={500}
        required
      />
      <button type="submit" disabled={pending || reason.trim().length === 0} className={btnCls}>
        {label}
      </button>
      {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
    </form>
  );
}

export function LiftHoldButton({ holdId, label }: { holdId: string; label: string }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={pending} className={btnCls} onClick={() => run(() => liftPayoutHold({ holdId }))}>
        {label}
      </button>
      {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
    </span>
  );
}

export function MethodSwitch({
  teacherId,
  current,
  label,
  confirmText,
}: {
  teacherId: string;
  current: "stripe_connect" | "manual";
  label: string;
  confirmText: string;
}) {
  const { pending, msg, run } = useAct();
  const target = current === "manual" ? "stripe_connect" : "manual";
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        className={btnCls}
        onClick={() => {
          if (window.confirm(confirmText)) {
            run(() => setPayoutMethod({ teacherId, method: target }));
          }
        }}
      >
        {label}
      </button>
      {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
    </span>
  );
}

export function SettleForm({
  entryId,
  netDueCents,
  label,
  closeLabel,
  confirmText,
}: {
  entryId: string;
  /** FR-027a: the net the queue displayed — sent as the optimistic fence. */
  netDueCents: number;
  label: string;
  /** Shown instead of the reference form when net is 0 (nothing to pay). */
  closeLabel: string;
  confirmText: string;
}) {
  const { pending, msg, run } = useAct();
  const [reference, setReference] = useState("");

  // Net 0 ⇒ the entry is fully consumed by debt: nothing is paid, so there is
  // no payment reference — a single confirm-guarded close instead of the form.
  if (netDueCents === 0) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          disabled={pending}
          className={btnCls}
          onClick={() => {
            if (!window.confirm(confirmText)) return;
            run(() => settleManualDueEntry({ entryId, expectedNetCents: 0 }));
          }}
        >
          {closeLabel}
        </button>
        {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
      </span>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        // An audited financial settlement — confirm like the rail switch does.
        if (!window.confirm(confirmText)) return;
        run(() =>
          settleManualDueEntry({ entryId, referenceId: reference, expectedNetCents: netDueCents }),
        );
      }}
    >
      <input
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="ref"
        aria-label={`${label} reference`}
        className={inputCls}
        maxLength={255}
        required
      />
      <button type="submit" disabled={pending || reference.trim().length === 0} className={btnCls}>
        {label}
      </button>
      {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
    </form>
  );
}

/** FR-011: send a terminal-failed entry back to `pending` (audited). */
export function RequeueButton({ entryId, label, confirmText }: {
  entryId: string;
  label: string;
  confirmText: string;
}) {
  const { pending, msg, run } = useAct();
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        className={btnCls}
        onClick={() => {
          if (!window.confirm(confirmText)) return;
          run(() => requeueFailedEntry({ entryId }));
        }}
      >
        {label}
      </button>
      {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
    </span>
  );
}

export function ExportButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        className={btnCls}
        onClick={() =>
          startTransition(async () => {
            const res = await exportManualDueCsv();
            if (!res.ok) {
              setMsg(`error: ${res.error}`);
              return;
            }
            const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "manual-due-queue.csv";
            a.click();
            URL.revokeObjectURL(url);
            setMsg(`${res.rows} rows`);
          })
        }
      >
        {label}
      </button>
      {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
    </span>
  );
}

export function SweepButton({ label, confirmText }: { label: string; confirmText: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        className={btnCls}
        onClick={() => {
          if (!window.confirm(confirmText)) return;
          startTransition(async () => {
            try {
              const res = await fetch("/api/admin/payouts/sweep", { method: "POST" });
              const body = (await res.json()) as Record<string, unknown>;
              setMsg(res.ok ? JSON.stringify(body) : `error: ${String(body.error ?? res.status)}`);
              router.refresh();
            } catch {
              setMsg("error: network");
            }
          });
        }}
      >
        {label}
      </button>
      {msg ? <span className="max-w-80 truncate text-xs text-muted-foreground" title={msg}>{msg}</span> : null}
    </span>
  );
}
