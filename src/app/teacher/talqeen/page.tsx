import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Mic } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  getTalqeenQueueForTeacher,
  type TalqeenFilter,
} from "@/lib/teacher-queries";
import { TalqeenQueue } from "./talqeen-queue";

export const metadata: Metadata = { title: "صندوق التلقين" };

const VALID_FILTERS: TalqeenFilter[] = ["all", "today", "this-week", "overdue"];

function parseFilter(raw: string | string[] | undefined): TalqeenFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return VALID_FILTERS.includes(value as TalqeenFilter)
    ? (value as TalqeenFilter)
    : "all";
}

export default async function TeacherTalqeenPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const filter = parseFilter(params.filter);

  const rows = await getTalqeenQueueForTeacher(user.id, filter);
  const overdueCount = rows.filter((r) => r.streakBreakRisk).length;

  return (
    <main dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Mic size={24} className="text-gold" />}
        title={t("صندوق التلقين", "Talqeen Inbox")}
        subtitle={
          rows.length > 0
            ? t(
                `${rows.length} تسجيل بانتظار التصحيح${overdueCount > 0 ? ` · ${overdueCount} متأخرة` : ""}.`,
                `${rows.length} recording${rows.length === 1 ? "" : "s"} awaiting correction${overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}.`,
              )
            : t(
                "لا توجد تسجيلات بانتظار التصحيح حالياً.",
                "No recordings awaiting correction right now.",
              )
        }
      />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            variant="glass-card"
            icon={<Mic size={32} className="text-muted" />}
            message={t(
              "صندوق التلقين فارغ.",
              "Your talqeen inbox is empty.",
            )}
            hint={t(
              "ستظهر هنا كل تسجيلات التلاوة التي رفعها طلابك بانتظار تصحيحك.",
              "Recitation recordings your students submit will appear here when they're ready for your review.",
            )}
          />
        </div>
      ) : (
        <TalqeenQueue rows={rows} activeFilter={filter} />
      )}
    </main>
  );
}
