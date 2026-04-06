import { DashboardLayout } from "@/components/shared/dashboard-layout";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout role="student">{children}</DashboardLayout>;
}
