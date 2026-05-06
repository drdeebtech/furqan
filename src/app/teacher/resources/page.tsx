import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { UploadResourceForm } from "./upload-form";
import {
  ResourceList,
  type RosterStudent,
  type TeacherResourceRow,
} from "./resource-list";

export const metadata: Metadata = { title: "مصادر المعلم" };

interface ResourceRow {
  id: string;
  title_ar: string;
  resource_type: TeacherResourceRow["resourceType"];
  file_url: string | null;
  external_url: string | null;
  created_at: string;
}

interface AssignmentCountRow {
  resource_id: string;
}

interface BookingStudentRow {
  student_id: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
}

export default async function TeacherResourcesPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Three parallel reads:
  //  1. The teacher's own resource rows (RLS gates these to created_by_teacher_id = self).
  //  2. Assignment rows for those resources (so we can show "N students" per resource).
  //  3. Distinct student_ids from teacher's bookings + their names — the roster
  //     dropdown source for the per-row assign form.
  // `created_by_teacher_id` is from migration 20260506134112; cast `.eq`
  // until `supabase.generated.ts` regenerates post-merge.
  type ResourcesByOwnerClient = {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => Promise<{ data: ResourceRow[] | null; error: unknown }>;
        };
      };
    };
  };
  const [resourcesRes, bookingsRes] = await Promise.all([
    (supabase as unknown as ResourcesByOwnerClient)
      .from("resources")
      .select("id, title_ar, resource_type, file_url, external_url, created_at")
      .eq("created_by_teacher_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("student_id")
      .eq("teacher_id", user.id)
      .returns<BookingStudentRow[]>(),
  ]);
  if (resourcesRes.error) throw resourcesRes.error;
  if (bookingsRes.error) throw bookingsRes.error;

  const resources = resourcesRes.data;
  const resourceIds = resources ? resources.map((r) => r.id) : [];

  const studentIds = bookingsRes.data
    ? [...new Set(bookingsRes.data.map((b) => b.student_id))]
    : [];

  // See actions.ts — `resource_assignments` is added in migration
  // 20260506134112 but `supabase.generated.ts` regenerates only after merge.
  type AssignmentsClient = {
    from: (table: string) => {
      select: (cols: string) => {
        in: (
          col: string,
          values: string[],
        ) => Promise<{ data: AssignmentCountRow[] | null; error: unknown }>;
      };
    };
  };
  const [assignmentsRes, profilesRes] = await Promise.all([
    resourceIds.length > 0
      ? (supabase as unknown as AssignmentsClient)
          .from("resource_assignments")
          .select("resource_id")
          .in("resource_id", resourceIds)
      : Promise.resolve({ data: [] as AssignmentCountRow[], error: null }),
    studentIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", studentIds)
          .returns<ProfileRow[]>()
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
  ]);
  if (assignmentsRes.error) throw assignmentsRes.error;
  if (profilesRes.error) throw profilesRes.error;

  const assignCount = new Map<string, number>();
  if (assignmentsRes.data) {
    for (const a of assignmentsRes.data) {
      assignCount.set(
        a.resource_id,
        (assignCount.get(a.resource_id) ?? 0) + 1,
      );
    }
  }

  const rows: TeacherResourceRow[] = resources
    ? resources.map((r) => ({
        id: r.id,
        titleAr: r.title_ar,
        resourceType: r.resource_type,
        fileUrl: r.file_url,
        externalUrl: r.external_url,
        createdAt: r.created_at,
        assignmentCount: assignCount.get(r.id) ?? 0,
      }))
    : [];

  const roster: RosterStudent[] = profilesRes.data
    ? profilesRes.data.map((p) => ({
        id: p.id,
        fullName: p.full_name ?? "—",
      }))
    : [];

  return (
    <main dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<FileText size={24} className="text-gold" />}
        title={t("مصادري", "My Resources")}
        subtitle={t(
          "ارفع PDF / صوت / فيديو / رابط ثم أسنده لطلابك.",
          "Upload PDFs, audio, video, or links and share them with your students.",
        )}
      />

      <div className="mt-6 space-y-6">
        <UploadResourceForm />

        {rows.length === 0 ? (
          <EmptyState
            variant="glass-card"
            icon={<FileText size={32} className="text-muted" />}
            message={t("لم ترفع أي مصدر بعد.", "You haven't uploaded any resource yet.")}
            hint={t(
              "بمجرد الرفع، يمكنك إسناد المصدر لطالب أو أكثر من قائمة طلابك.",
              "After uploading, you can assign each resource to one or more students from your roster.",
            )}
          />
        ) : (
          <ResourceList rows={rows} roster={roster} />
        )}
      </div>
    </main>
  );
}
