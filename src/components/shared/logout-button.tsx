"use client";

import { LogOut } from "lucide-react";
import posthog from "posthog-js";
import { useLang } from "@/lib/i18n/context";
import { mixpanelClient } from "@/lib/mixpanel-client";

export function LogoutButton() {
  const { t } = useLang();
  return (
    <form
      action="/api/auth/logout"
      method="POST"
      // Identity hygiene on shared devices: clear both analytics identities
      // before the POST navigates away, so the next user on this browser
      // doesn't inherit this distinct_id. Does not preventDefault — the form
      // still submits.
      onSubmit={() => {
        posthog.reset();
        mixpanelClient()?.reset();
      }}
    >
      <button
        type="submit"
        aria-label={t("تسجيل الخروج", "Log out")}
        className="flex items-center gap-1.5 glass glass-pill px-3 py-1.5 text-sm text-muted transition-colors hover:border-error/50 hover:text-error focus-ring"
      >
        <LogOut size={14} aria-hidden="true" />
        <span className="hidden sm:inline">{t("خروج", "Log out")}</span>
      </button>
    </form>
  );
}
