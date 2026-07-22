import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Mic } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getTeacherRecitationRoster } from "@/lib/views/teacher-recitations";
import { RecitationRoster } from "./recitation-roster";

export const metadata: Metadata = { title: "تسميعات الطلاب" };

export default async function TeacherRecitationsPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rows = await getTeacherRecitationRoster(supabase, user.id);
  const atRiskCount = rows.filter((r) => r.streakBreakRisk).length;

  return (
    <main dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Mic size={24} className="text-gold" />}
        title={t("تسميعات الطلاب", "Student Recitations")}
        subtitle={
          rows.length > 0
            ? t(
                `${rows.length} طالب${atRiskCount > 0 ? ` · ${atRiskCount} بحاجة لمتابعة` : ""}.`,
                `${rows.length} student${rows.length === 1 ? "" : "s"}${atRiskCount > 0 ? ` · ${atRiskCount} need follow-up` : ""}.`,
              )
            : t(
                "ستظهر هنا قائمة طلابك بمجرد أن يكون لديك حجز معهم.",
                "Your student roster will appear here once you have at least one booking.",
              )
        }
      />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            variant="glass-card"
            icon={<Mic size={32} className="text-muted" />}
            message={t(
              "لا يوجد طلاب بعد.",
              "No students yet.",
            )}
            hint={t(
              "بمجرد أن يحجز طلاب معك، ستظهر تسميعاتهم وتقدّمهم هنا.",
              "Once students book sessions with you, their recitations and progress will appear here.",
            )}
          />
        </div>
      ) : (
        <RecitationRoster rows={rows} />
      )}
    </main>
  );
}
