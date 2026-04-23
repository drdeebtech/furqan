"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageSquare, Star, Eye, X, BellRing, Check, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import {
  hideMessage,
  clearMessageFlag,
  pingAdminOnEvaluation,
  dismissEvaluation,
  type ModerationResult,
} from "./actions";

interface FlaggedMessageView {
  id: string;
  content: string;
  msgType: string;
  createdAt: string;
  flaggedAt: string | null;
  flagReason: string | null;
  senderId: string;
  senderName: string;
  studentName: string;
  teacherName: string;
}

interface LowEvaluationView {
  id: string;
  studentId: string;
  studentName: string;
  teacherName: string;
  evaluationType: string;
  periodStart: string;
  periodEnd: string;
  overallScore: number | null;
  weaknesses: string | null;
  createdAt: string;
}

interface Props {
  messages: FlaggedMessageView[];
  evaluations: LowEvaluationView[];
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

export function ModerationClient({ messages, evaluations }: Props) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<"messages" | "evaluations">("messages");

  return (
    <div>
      <div className="mb-6 flex gap-2 rounded-xl border border-surface-border/60 bg-surface/30 p-1">
        <TabButton active={tab === "messages"} onClick={() => setTab("messages")} icon={MessageSquare} label={t("الرسائل", "Messages")} count={messages.length} />
        <TabButton active={tab === "evaluations"} onClick={() => setTab("evaluations")} icon={Star} label={t("التقييمات", "Evaluations")} count={evaluations.length} />
      </div>

      {tab === "messages" ? (
        messages.length === 0 ? (
          <EmptyState message={t("لا يوجد رسائل مُبلَّغ عنها.", "No flagged messages.")} />
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <MessageCard key={m.id} msg={m} lang={lang} t={t} />
            ))}
          </ul>
        )
      ) : evaluations.length === 0 ? (
        <EmptyState message={t("لا يوجد تقييمات منخفضة في آخر 7 أيام.", "No low-scoring evaluations in the last 7 days.")} />
      ) : (
        <ul className="space-y-3">
          {evaluations.map((e) => (
            <EvaluationCard key={e.id} ev={e} lang={lang} t={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
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
      <Icon size={16} />
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-gold/20" : "bg-surface/60"}`}>
        {count}
      </span>
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

function MessageCard({
  msg,
  lang,
  t,
}: {
  msg: FlaggedMessageView;
  lang: "ar" | "en";
  t: (ar: string, en: string) => string;
}) {
  const [result, setResult] = useState<ModerationResult | null>(null);
  const [hideReason, setHideReason] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [pending, start] = useTransition();

  const needsTruncation = msg.content.length > 200;
  const displayed = needsTruncation && !showFull ? msg.content.slice(0, 200) + "…" : msg.content;

  const onHide = () => {
    start(async () => {
      const r = await hideMessage(msg.id, hideReason);
      setResult(r);
    });
  };
  const onClear = () => {
    start(async () => {
      const r = await clearMessageFlag(msg.id);
      setResult(r);
    });
  };

  return (
    <li className="rounded-2xl border border-surface-border/60 bg-surface/40 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="font-medium text-foreground">{msg.senderName}</span>
        <span>·</span>
        <span>
          {t("محادثة", "Conversation")}: {msg.studentName} ↔ {msg.teacherName}
        </span>
        <span>·</span>
        <span>{relativeTime(msg.flaggedAt, lang)}</span>
      </div>

      <p className="mb-3 whitespace-pre-wrap text-sm text-foreground">{displayed}</p>

      {needsTruncation && (
        <button
          onClick={() => setShowFull(!showFull)}
          className="mb-3 text-xs font-medium text-gold hover:text-gold-light"
        >
          {showFull ? t("إخفاء", "Show less") : t("عرض الكامل", "Show full")}
        </button>
      )}

      {msg.flagReason && (
        <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={12} className="me-1 inline" /> {msg.flagReason}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={hideReason}
          onChange={(e) => setHideReason(e.target.value)}
          placeholder={t("سبب الإخفاء (3 أحرف على الأقل)", "Hide reason (min 3 chars)")}
          aria-label={t("سبب الإخفاء", "Hide reason")}
          className="glass-input flex-1 rounded-lg px-3 py-1.5 text-xs"
        />
        <button
          onClick={onHide}
          disabled={pending || hideReason.trim().length < 3}
          className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
        >
          <X size={14} /> {t("إخفاء", "Hide")}
        </button>
        <button
          onClick={onClear}
          disabled={pending}
          className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
        >
          <Check size={14} /> {t("مسح العلامة", "Clear flag")}
        </button>
        <Link
          href={`/admin/users/${msg.senderId}/timeline`}
          className="flex items-center gap-1 rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted transition-colors hover:border-gold/40 hover:text-gold"
        >
          <Eye size={14} /> {t("الجدول الزمني", "Timeline")}
        </Link>
      </div>

      {result && (
        <p className={`mt-3 text-xs ${result.error ? "text-red-400" : "text-emerald-400"}`}>
          {result.error ?? result.success}
        </p>
      )}
    </li>
  );
}

function EvaluationCard({
  ev,
  lang,
  t,
}: {
  ev: LowEvaluationView;
  lang: "ar" | "en";
  t: (ar: string, en: string) => string;
}) {
  const [result, setResult] = useState<ModerationResult | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const scoreClass =
    ev.overallScore !== null && ev.overallScore <= 2.0
      ? "text-red-400"
      : "text-amber-400";

  const onPing = () => {
    start(async () => setResult(await pingAdminOnEvaluation(ev.id)));
  };
  const onDismiss = () => {
    start(async () => setResult(await dismissEvaluation(ev.id, note)));
  };

  return (
    <li className="rounded-2xl border border-surface-border/60 bg-surface/40 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="text-xs text-muted">
          <p className="text-sm font-medium text-foreground">
            {ev.studentName} <span className="text-muted">·</span> {ev.teacherName}
          </p>
          <p className="mt-1">
            {ev.evaluationType} · {new Date(ev.periodStart).toLocaleDateString()} → {new Date(ev.periodEnd).toLocaleDateString()}
          </p>
        </div>
        <div className="text-right">
          <p className={`font-display text-3xl font-bold ${scoreClass}`}>
            {ev.overallScore !== null ? ev.overallScore.toFixed(2) : "—"}
          </p>
          <p className="text-xs text-muted">/ 5</p>
        </div>
      </div>

      {ev.weaknesses && (
        <p className="mb-3 rounded-lg bg-surface/60 px-3 py-2 text-xs text-muted">
          <span className="font-medium text-foreground">{t("نقاط الضعف:", "Weaknesses:")}</span>{" "}
          {ev.weaknesses.length > 240 ? ev.weaknesses.slice(0, 240) + "…" : ev.weaknesses}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("ملاحظة المراجعة (اختياري)", "Review note (optional)")}
          aria-label={t("ملاحظة المراجعة", "Review note")}
          className="glass-input flex-1 rounded-lg px-3 py-1.5 text-xs"
        />
        <button
          onClick={onPing}
          disabled={pending}
          className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        >
          <BellRing size={14} /> {t("تنبيه الفريق", "Ping team")}
        </button>
        <button
          onClick={onDismiss}
          disabled={pending}
          className="flex items-center gap-1 rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
        >
          <Check size={14} /> {t("تم المراجعة", "Dismiss")}
        </button>
        <Link
          href={`/admin/users/${ev.studentId}/timeline`}
          className="flex items-center gap-1 rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted transition-colors hover:border-gold/40 hover:text-gold"
        >
          <Eye size={14} /> {t("الجدول الزمني", "Timeline")}
        </Link>
      </div>

      {result && (
        <p className={`mt-3 text-xs ${result.error ? "text-red-400" : "text-emerald-400"}`}>
          {result.error ?? result.success}
        </p>
      )}
    </li>
  );
}
