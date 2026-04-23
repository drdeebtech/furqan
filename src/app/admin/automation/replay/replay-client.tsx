"use client";

import { useState, useTransition } from "react";
import { Eye, RotateCw, Check, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { replayAutomation, markDeadLetterResolved, type ReplayResult } from "./actions";

interface FailedLog {
  id: string;
  workflow_name: string;
  event_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  idempotency_key: string | null;
  payload_json: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface DeadLetter {
  id: string;
  workflow_name: string;
  event_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  idempotency_key: string | null;
  payload_json: Record<string, unknown> | null;
  last_error: string | null;
  attempt_count: number;
  first_failed_at: string;
  last_failed_at: string;
}

function relativeTime(iso: string | null, locale: "ar" | "en"): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return locale === "ar" ? "الآن" : "just now";
  if (mins < 60) return locale === "ar" ? `منذ ${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return locale === "ar" ? `منذ ${hrs} س` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return locale === "ar" ? `منذ ${days} يوم` : `${days}d ago`;
}

export function ReplayClient({
  failures,
  deadLetters,
}: {
  failures: FailedLog[];
  deadLetters: DeadLetter[];
}) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<"failures" | "dead_letter">("failures");

  return (
    <div>
      <div className="mb-6 flex gap-2 rounded-xl border border-surface-border/60 bg-surface/30 p-1">
        <Tab active={tab === "failures"} onClick={() => setTab("failures")} label={t("فشل حديث", "Recent Failures")} count={failures.length} />
        <Tab active={tab === "dead_letter"} onClick={() => setTab("dead_letter")} label={t("طابور ميت", "Dead-Letter")} count={deadLetters.length} />
      </div>

      {tab === "failures" ? (
        failures.length === 0 ? (
          <EmptyState message={t("لا يوجد فشل حديث.", "No recent failures.")} />
        ) : (
          <ul className="space-y-3">
            {failures.map((f) => (
              <FailedRow key={f.id} row={f} lang={lang} t={t} />
            ))}
          </ul>
        )
      ) : deadLetters.length === 0 ? (
        <EmptyState message={t("لا يوجد مهام في الطابور الميت.", "Dead-letter queue is empty.")} />
      ) : (
        <ul className="space-y-3">
          {deadLetters.map((d) => (
            <DeadLetterRowView key={d.id} row={d} lang={lang} t={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
        active ? "bg-gold/15 text-gold" : "text-muted hover:text-foreground"
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-gold/20" : "bg-surface/60"}`}>{count}</span>
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-surface-border/60 bg-surface/40 p-10 text-center text-sm text-muted">
      {message}
    </div>
  );
}

function FailedRow({
  row,
  lang,
  t,
}: {
  row: FailedLog;
  lang: "ar" | "en";
  t: (ar: string, en: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ReplayResult | null>(null);

  const onReplay = () => {
    start(async () => {
      setResult(await replayAutomation({ source: "log", id: row.id }));
    });
  };

  return (
    <li className="rounded-2xl border border-surface-border/60 bg-surface/40 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{row.workflow_name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {row.event_name ?? "?"} · {row.entity_type ?? "?"}/{row.entity_id?.slice(0, 8) ?? "?"} · {relativeTime(row.started_at, lang)}
          </p>
        </div>
      </div>

      {row.error_message && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap break-all">{row.error_message}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onReplay}
          disabled={pending || !row.payload_json || !row.event_name}
          className="flex items-center gap-1 rounded-lg border border-gold/40 bg-gold/15 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/25 disabled:opacity-40"
        >
          <RotateCw size={14} /> {t("إعادة إرسال", "Replay")}
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
        >
          <Eye size={14} /> {expanded ? t("إخفاء المحتوى", "Hide payload") : t("عرض المحتوى", "View payload")}
        </button>
      </div>

      {expanded && row.payload_json && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-background/80 p-3 text-[10px] text-muted" dir="ltr">
          {JSON.stringify(row.payload_json, null, 2)}
        </pre>
      )}

      {result && (
        <p className={`mt-3 text-xs ${result.error ? "text-red-400" : "text-emerald-400"}`}>
          {result.error ?? result.success}
        </p>
      )}
    </li>
  );
}

function DeadLetterRowView({
  row,
  lang,
  t,
}: {
  row: DeadLetter;
  lang: "ar" | "en";
  t: (ar: string, en: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [note, setNote] = useState("");

  const onReplay = () => {
    start(async () => {
      setResult(await replayAutomation({ source: "dead_letter", id: row.id }));
    });
  };

  const onResolve = () => {
    start(async () => {
      setResult(await markDeadLetterResolved({ id: row.id, notes: note }));
    });
  };

  return (
    <li className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{row.workflow_name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {row.event_name ?? "?"} · {row.entity_type ?? "?"}/{row.entity_id?.slice(0, 8) ?? "?"}
          </p>
          <p className="mt-0.5 text-xs text-red-400">
            {t(`${row.attempt_count} محاولات · آخر فشل ${relativeTime(row.last_failed_at, lang)}`, `${row.attempt_count} attempts · last failed ${relativeTime(row.last_failed_at, lang)}`)}
          </p>
        </div>
      </div>

      {row.last_error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap break-all">{row.last_error}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onReplay}
          disabled={pending || !row.payload_json || !row.event_name}
          className="flex items-center gap-1 rounded-lg border border-gold/40 bg-gold/15 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/25 disabled:opacity-40"
        >
          <RotateCw size={14} /> {t("إعادة إرسال", "Replay")}
        </button>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("ملاحظة الحل", "Resolution note")}
          aria-label={t("ملاحظة الحل", "Resolution note")}
          className="glass-input flex-1 rounded-lg px-3 py-1.5 text-xs"
        />
        <button
          onClick={onResolve}
          disabled={pending}
          className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
        >
          <Check size={14} /> {t("تم الحل", "Mark resolved")}
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
        >
          <Eye size={14} /> {expanded ? t("إخفاء", "Hide") : t("عرض المحتوى", "View payload")}
        </button>
      </div>

      {expanded && row.payload_json && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-background/80 p-3 text-[10px] text-muted" dir="ltr">
          {JSON.stringify(row.payload_json, null, 2)}
        </pre>
      )}

      {result && (
        <p className={`mt-3 text-xs ${result.error ? "text-red-400" : "text-emerald-400"}`}>
          {result.error ?? result.success}
        </p>
      )}
    </li>
  );
}
