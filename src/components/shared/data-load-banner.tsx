import { AlertTriangle } from "lucide-react";
import { getT } from "@/lib/i18n/server";

/**
 * Server-rendered banner that surfaces "some widgets failed to load"
 * to the user. Companion to `loadOrFail()` from
 * `@/lib/supabase/load-or-fail` — pages OR the components below should
 * track an `anyFailed` boolean across all loads on the page and pass
 * it here.
 *
 * Renders nothing when `failed=false` so callers can drop it in
 * unconditionally without an additional check.
 */
export async function DataLoadBanner({ failed }: { failed: boolean }) {
  if (!failed) return null;
  const { t } = await getT();
  return (
    <div
      role="alert"
      className="mb-3 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {t(
          "تعذر تحميل بعض البيانات — حدّث الصفحة. تم تنبيه فريق الدعم.",
          "Some data couldn't load — please refresh. Our team has been notified.",
        )}
      </span>
    </div>
  );
}
