import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { MobileRegisterBar } from "@/components/public/mobile-register-bar";
import { LazyWelcomePopup } from "@/components/public/lazy-welcome-popup";
import { SiteAnnouncementBanner } from "@/components/public/site-announcement-banner";
import { OrganizationSchema, FAQSchema } from "@/components/seo/structured-data";
import { PublicDirWrapper } from "./dir-wrapper";
import { FeatureFlagsProvider } from "@/lib/feature-flags-context";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

const ROLE_HOME: Record<string, string> = {
  student: "/student/dashboard",
  teacher: "/teacher/dashboard",
  admin: "/admin",
  moderator: "/moderator",
};

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getSettings();
  const flags = {
    hideReviews: settings["hide_reviews"] === "true",
    hidePrices: settings["hide_prices"] === "true",
    hideTeachersPage: settings["hide_teachers_page"] === "true",
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
      <FAQSchema />
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
