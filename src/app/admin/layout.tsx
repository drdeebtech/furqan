import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/shared/dashboard-layout";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/login");
    throw e;
  }
  return <DashboardLayout role="admin">{children}</DashboardLayout>;
}
