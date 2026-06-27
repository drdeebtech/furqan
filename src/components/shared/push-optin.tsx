"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Download } from "lucide-react";

type PushState =
  | "checking"
  | "unsupported"
  | "ios-install"
  | "prompt"
  | "subscribed"
  | "denied"
  | "error";

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(base64);
  const output = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    output[index] = decoded.charCodeAt(index);
  }
  return output;
}

function isIosNotInstalled(): boolean {
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return isIos && !standalone;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  return (
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"))
  );
}

export function PushOptIn() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function inspectPushState() {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (active) setState("unsupported");
        return;
      }
      if (isIosNotInstalled()) {
        if (active) setState("ios-install");
        return;
      }
      if (Notification.permission === "denied") {
        if (active) setState("denied");
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (active) setState(subscription ? "subscribed" : "prompt");
    }

    void inspectPushState().catch(() => {
      if (active) setState("error");
    });
    return () => {
      active = false;
    };
  }, []);

  async function enablePush() {
    setBusy(true);
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Missing public VAPID key");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "prompt");
        return;
      }

      const registration = await getRegistration();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error("Push subscription could not be saved");
      }
      setState("subscribed");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setState("prompt");
        return;
      }

      const response = await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) throw new Error("Push subscription could not be removed");
      await subscription.unsubscribe();
      setState("prompt");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return null;

  const shellClass =
    "fixed bottom-20 start-4 z-40 max-w-72 rounded-xl border border-gold/20 bg-surface px-3 py-2 text-sm text-foreground shadow-lg";

  if (state === "ios-install") {
    return (
      <aside dir="rtl" lang="ar" className={shellClass} aria-live="polite">
        <p className="flex items-center gap-2">
          <Download className="size-4 shrink-0 text-gold" aria-hidden="true" />
          أضف التطبيق إلى الشاشة الرئيسية لتفعيل الإشعارات.
        </p>
      </aside>
    );
  }

  if (state === "unsupported" || state === "denied" || state === "error") {
    const message =
      state === "unsupported"
        ? "الإشعارات غير مدعومة على هذا الجهاز."
        : state === "denied"
          ? "الإشعارات متوقفة. يمكنك تفعيلها من إعدادات المتصفح."
          : "تعذّر تحديث إعدادات الإشعارات. حاول لاحقًا.";
    return (
      <aside dir="rtl" lang="ar" className={shellClass} aria-live="polite">
        <p className="flex items-center gap-2 text-muted">
          <BellOff className="size-4 shrink-0" aria-hidden="true" />
          {message}
        </p>
      </aside>
    );
  }

  const subscribed = state === "subscribed";
  return (
    <button
      type="button"
      dir="rtl"
      lang="ar"
      disabled={busy}
      onClick={subscribed ? disablePush : enablePush}
      className={`${shellClass} flex min-h-11 items-center gap-2 transition-colors hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none`}
      aria-pressed={subscribed}
    >
      {subscribed ? (
        <BellRing className="size-4 shrink-0 text-gold" aria-hidden="true" />
      ) : (
        <Bell className="size-4 shrink-0 text-gold" aria-hidden="true" />
      )}
      {busy
        ? "جارٍ تحديث الإشعارات…"
        : subscribed
          ? "الإشعارات مفعّلة — اضغط لإيقافها"
          : "فعّل تذكيرات الحفظ والمراجعة"}
    </button>
  );
}
