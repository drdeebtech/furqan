import { DashboardLayout } from "@/components/shared/dashboard-layout";

export default function ModeratorLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout role="moderator">{children}</DashboardLayout>;
}
