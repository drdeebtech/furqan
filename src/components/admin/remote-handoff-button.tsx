"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Smartphone, Copy, Check, X, Loader2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { requestHandoff, revokeMyHandoffs } from "@/lib/auth/remote-handoff";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; qrSvg: string; url: string; expiresAt: number }
  | { kind: "error"; message: string };

export function RemoteHandoffButton({ targetPath = "/admin/control-tower" }: { targetPath?: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [, startRevoke] = useTransition();
  const overlayRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setState({ kind: "idle" });
  }, []);

  const handleOpen = useCallback(async () => {
    setOpen(true);
    setState({ kind: "loading" });
    const result = await requestHandoff({ targetPath });
    if (result.ok) {
      setState({
        kind: "ready",
        qrSvg: result.qrSvg,
        url: result.url,
        expiresAt: new Date(result.expiresAt).getTime(),
      });
    } else {
      setState({ kind: "error", message: result.error });
    }
  }, [targetPath]);

  // Tick every second while a code is live so the countdown updates.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  // Auto-flip to expired when the countdown hits zero.
  useEffect(() => {
    if (state.kind === "ready" && now >= state.expiresAt) {
      setState({ kind: "error", message: t("انتهت صلاحية الرمز.", "Code expired.") });
    }
  }, [now, state, t]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const handleCopy = useCallback(async () => {
    if (state.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be denied; user can long-press the URL text instead
    }
  }, [state]);

  const handleCancel = useCallback(() => {
    startRevoke(async () => {
      await revokeMyHandoffs();
      close();
    });
  }, [close]);

  const remainingSec = state.kind === "ready" ? Math.max(0, Math.floor((state.expiresAt - now) / 1000)) : 0;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");

  return (
    <>
      {/* Hidden on mobile — there is no "send to phone" use case from a phone. */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label={t("افتح على الهاتف", "Open on phone")}
        title={t("افتح على الهاتف", "Open on phone")}
        className="glass hidden h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-foreground/5 md:inline-flex"
      >
        <Smartphone size={18} className="text-gold" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("افتح على الهاتف", "Open on phone")}
          onClick={(e) => {
            if (e.target === overlayRef.current) close();
          }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div className="glass-card relative w-full max-w-sm p-6">
            <button
              type="button"
              onClick={close}
              aria-label={t("إغلاق", "Close")}
              className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-foreground/5"
            >
              <X size={18} aria-hidden="true" />
            </button>

            <div className="mb-4 flex items-center gap-2">
              <Smartphone size={18} className="text-gold" aria-hidden="true" />
              <h2 className="font-display text-lg font-bold">{t("افتح على الهاتف", "Open on phone")}</h2>
            </div>

            {state.kind === "loading" && (
              <div className="flex h-64 items-center justify-center">
                <Loader2 size={28} className="animate-spin text-gold" aria-hidden="true" />
              </div>
            )}

            {state.kind === "error" && (
              <div role="alert" className="rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
                {state.message}
              </div>
            )}

            {state.kind === "ready" && (
              <>
                <p className="mb-3 text-xs text-muted">
                  {t(
                    "امسح الرمز بكاميرا الهاتف أو انسخ الرابط. صالح لمرة واحدة فقط.",
                    "Scan with your phone camera or copy the link. Single-use only.",
                  )}
                </p>

                <div
                  className="mx-auto mb-4 w-fit rounded-xl bg-white p-3"
                  // eslint-disable-next-line react/no-danger -- our own server-rendered SVG
                  dangerouslySetInnerHTML={{ __html: state.qrSvg }}
                  aria-label={t("رمز الاستجابة السريعة", "QR code")}
                />

                <div className="mb-3 flex items-center justify-between rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-2 ps-3">
                  <code className="truncate text-xs text-muted">{state.url}</code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={t("نسخ الرابط", "Copy link")}
                    className="ms-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-foreground/5"
                  >
                    {copied ? (
                      <Check size={14} className="text-success" aria-hidden="true" />
                    ) : (
                      <Copy size={14} className="text-muted" aria-hidden="true" />
                    )}
                  </button>
                </div>

                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="text-muted">{t("ينتهي خلال", "Expires in")}</span>
                  <span className="font-mono tabular-nums text-foreground">{mm}:{ss}</span>
                </div>

                <button
                  type="button"
                  onClick={handleCancel}
                  className="w-full rounded-xl border border-[var(--surface-border)] py-2 text-sm text-muted transition-colors hover:bg-foreground/5"
                >
                  {t("إلغاء الرمز", "Revoke code")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
