import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { loadControlTowerSnapshot } from "@/app/admin/control-tower/data";
import { ControlTowerGrid } from "@/components/admin/control-tower-grid";
import { DataLoadBanner } from "@/components/shared/data-load-banner";

export const metadata: Metadata = { title: "مركز التحكم" };

export default async function ControlTowerPage() {
  const { t, dir } = await getT();
  const initialData = await loadControlTowerSnapshot();

  return (
    <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <Activity size={24} className="text-gold" aria-hidden="true" />
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("مركز التحكم", "Control Tower")}</h1>
      </div>

      <DataLoadBanner failed={initialData.anyFailed} />
      <ControlTowerGrid initialData={initialData} />
    </div>
  );
}
