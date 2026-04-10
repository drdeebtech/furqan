"use client";

import { useState, useEffect, startTransition } from "react";
import { Power, PowerOff, RefreshCw, FileText } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { WidgetCard } from "@/components/shared/widget-card";

interface AdminAction {
  id: string;
  workflow_name: string;
  event_name: string;
  entity_id: string;
  status: string;
  payload_json: { actor_id?: string; action?: string; workflow_id?: string } | null;
  finished_at: string;
  created_at: string;
}

function actionIcon(eventName: string) {
  if (eventName.includes("activate") && !eventName.includes("deactivate")) {
    return <Power size={16} className="text-emerald-400" />;
  }
  if (eventName.includes("deactivate")) {
    return <PowerOff size={16} className="text-red-400" />;
  }
  if (eventName.includes("auto_restart")) {
    return <RefreshCw size={16} className="text-amber-400" />;
  }
  return <FileText size={16} className="text-muted" />;
}

export function AdminLogTab() {
  const { t } = useLang();
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/n8n/admin-actions")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        startTransition(() => {
          setActions(data.data ?? []);
          setLoading(false);
        });
      })
      .catch(() => {
        if (cancelled) return;
        startTransition(() => setLoading(false));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <WidgetCard
      title={t("سجل إجراءات المشرف", "Admin Actions Log")}
      subtitle={t(
        "جميع إجراءات التحكم في n8n",
        "All n8n control actions",
      )}
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted">
          <RefreshCw size={20} className="animate-spin" />
          <span className="ms-2 text-sm">
            {t("جاري التحميل...", "Loading...")}
          </span>
        </div>
      ) : actions.length === 0 ? (
        <div className="py-12 text-center text-muted">
          <FileText size={24} className="mx-auto mb-2 text-muted/30" />
          <p className="text-sm">
            {t("لا توجد إجراءات مسجلة", "No recorded actions")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => {
            const actorId = action.payload_json?.actor_id;
            const actor = actorId || t("نظام", "System");
            const timestamp = new Date(
              action.finished_at || action.created_at,
            ).toLocaleString("ar-SA", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={action.id}
                className="glass-card flex items-center gap-3 p-4"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
                  {actionIcon(action.event_name)}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {action.workflow_name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {action.event_name.replace("admin.", "")}
                    {" \u00b7 "}
                    {timestamp}
                  </p>
                </div>

                <div className="shrink-0 text-xs text-muted">
                  {t("المنفذ:", "Actor:")}{" "}
                  <span className="font-medium text-[var(--foreground)]">
                    {actor}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}
