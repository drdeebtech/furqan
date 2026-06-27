import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/shared/dashboard-layout";
import { requireRole, ForbiddenError } from "@/lib/auth/require-admin";
import { PostHogIdentify } from "@/components/shared/posthog-identify";
import { PushOptIn } from "@/components/shared/push-optin";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { JuzCelebration } from "@/components/student/juz-celebration";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  // Defense-in-depth: the edge middleware (src/proxy.ts) already gates the
  // /student prefix by active role, but mirror the admin layout's in-tree
  // guard so authorization never depends on the middleware matcher alone.
  let userId: string;
  try {
    ({ id: userId } = await requireRole("student"));
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/login");
    throw e;
  }
  return (
    <RealtimeProvider userId={userId}>
      <PostHogIdentify userId={userId} />
      <PushOptIn />
      <JuzCelebration />
      <DashboardLayout role="student">{children}</DashboardLayout>
    </RealtimeProvider>
  );
}
