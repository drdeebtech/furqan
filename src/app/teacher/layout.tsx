import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/shared/dashboard-layout";
import { requireRole, ForbiddenError } from "@/lib/auth/require-admin";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  // Defense-in-depth: the edge middleware (src/proxy.ts) already gates the
  // /teacher prefix by active role, but mirror the admin layout's in-tree
  // guard so authorization never depends on the middleware matcher alone.
  try {
    await requireRole("teacher");
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/login");
    throw e;
  }
  return <DashboardLayout role="teacher">{children}</DashboardLayout>;
}
