"use client";

import { useState } from "react";
import { Link2, Copy, Check, Trash2, Loader2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { generateParentLink, revokeParentLink } from "./actions";

interface TokenLite { id: string; createdAt: string; expiresAt: string }

/**
 * Parent magic-link manager (#563). Teacher generates a 30-day read-only link
 * to share with a parent, copies it, and can revoke active links. The raw token
 * is shown once on generation (it's never re-fetchable).
 */
export function ParentLinkManager({ studentId, initialTokens }: { studentId: string; initialTokens: TokenLite[] }) {
  const { t, lang } = useLang();
  const [tokens, setTokens] = useState<TokenLite[]>(initialTokens);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setGeneratedUrl(null);
    const res = await generateParentLink(studentId);
    if (res.error || !res.url) {
      setError(res.error ?? t("فشل إنشاء الرابط", "Failed to create link"));
    } else {
      setGeneratedUrl(res.url);
    }
    setBusy(false);
  }

  async function handleCopy() {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the URL is visible for manual copy */
    }
  }

  async function handleRevoke(tokenId: string) {
    setError(null);
    const res = await revokeParentLink(tokenId);
    if (res.error) setError(res.error);
    else setTokens((prev) => prev.filter((tk) => tk.id !== tokenId));
  }

  return (
    <div className="rounded-xl border border-card-border bg-card/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Link2 size={14} className="text-gold" aria-hidden="true" /> {t("رابط ولي الأمر", "Parent link")}
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold hover:bg-gold/20 disabled:opacity-50 focus-ring"
        >
          {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Link2 size={12} aria-hidden="true" />}
          {t("إنشاء رابط", "Generate link")}
        </button>
      </div>

      <p className="mt-1 text-[11px] text-muted-light">
        {t("رابط للعرض فقط، صالح 30 يومًا، بدون تسجيل دخول.", "Read-only, valid 30 days, no login required.")}
      </p>

      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      {generatedUrl && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            readOnly
            value={generatedUrl}
            className="glass-input min-w-0 flex-1 px-2 py-1 text-xs"
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t("رابط ولي الأمر", "Parent link")}
          />
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-full border border-card-border bg-card/40 px-2 py-1 text-xs hover:bg-card/60 focus-ring"
          >
            {copied ? <Check size={12} className="text-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
            {copied ? t("نُسخ", "Copied") : t("نسخ", "Copy")}
          </button>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="mt-2 space-y-1">
          {tokens.map((tk) => (
            <li key={tk.id} className="flex items-center justify-between gap-2 text-xs text-muted">
              <span>
                {t("ينتهي", "Expires")} {new Date(tk.expiresAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")}
              </span>
              <button
                type="button"
                onClick={() => handleRevoke(tk.id)}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-muted hover:text-error focus-ring"
                aria-label={t("إلغاء الرابط", "Revoke link")}
              >
                <Trash2 size={12} aria-hidden="true" /> {t("إلغاء", "Revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
