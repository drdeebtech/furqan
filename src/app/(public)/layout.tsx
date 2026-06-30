import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { MobileRegisterBar } from "@/components/public/mobile-register-bar";
import { LazyWelcomePopup } from "@/components/public/lazy-welcome-popup";
import { SiteAnnouncementBanner } from "@/components/public/site-announcement-banner";
import { OrganizationSchema } from "@/components/seo/structured-data";
import { PublicDirWrapper } from "./dir-wrapper";
import { FeatureFlagsProvider } from "@/lib/feature-flags-context";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { unstable_cache } from "next/cache";

const ROLE_HOME: Record<string, string> = {
  student: "/student/dashboard",
  teacher: "/teacher/dashboard",
  admin: "/admin",
  moderator: "/moderator",
};

// spec 035 US4 (FR-009): don't promote an empty room. The Courses nav link is
// hidden when zero courses are published, and reappears automatically once one
// is. Cached (5-min) so this is not a per-render DB query at 50k users; admin
// publish flows can revalidateTag('courses-public') for instant freshness.
const getHasPublishedCourses = unstable_cache(
  async (): Promise<boolean> => {
    const supabase = createAdminClient();
    const { count } = await supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("status", "published");
    return (count ?? 0) > 0;
  },
  ["public-has-published-courses"],
  { tags: ["courses-public"], revalidate: 300 },
);

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, hasPublishedCourses] = await Promise.all([
    getSettings(),
    getHasPublishedCourses(),
  ]);
  const flags = {
    hideReviews: settings["hide_reviews"] === "true",
    hidePrices: settings["hide_prices"] === "true",
    hideTeachersPage: settings["hide_teachers_page"] === "true",
    // Hidden by admin toggle OR automatically while no course is published.
    hideCourses: settings["hide_courses"] === "true" || !hasPublishedCourses,
  };

  // F3: when an authenticated user lands on a public route (e.g. /help),
  // surface their dashboard instead of Sign In + Register Now CTAs.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let dashboardHref: string | undefined;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id)
      .single<{ role: string }>();
    dashboardHref = ROLE_HOME[profile?.role ?? ""] ?? "/student/dashboard";
  }

  return (
    <FeatureFlagsProvider flags={flags}>
      <OrganizationSchema />
      <PublicDirWrapper>
        <SiteAnnouncementBanner />
        <PublicNav dashboardHref={dashboardHref} />
        <main id="main-content" className="pb-20 lg:pb-0">{children}</main>
        <PublicFooter />
        <WhatsAppButton />
        {!dashboardHref && <MobileRegisterBar />}
        {!dashboardHref && <LazyWelcomePopup />}
      </PublicDirWrapper>
    </FeatureFlagsProvider>
  );
}
