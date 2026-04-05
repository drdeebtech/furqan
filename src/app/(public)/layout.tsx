import { LangProvider } from "@/lib/i18n/context";
import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { OrganizationSchema, FAQSchema } from "@/components/seo/structured-data";
import { PublicDirWrapper } from "./dir-wrapper";
import { FeatureFlagsProvider } from "@/lib/feature-flags-context";
import { getSettings } from "@/lib/settings";

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

  return (
    <LangProvider>
      <FeatureFlagsProvider flags={flags}>
        <OrganizationSchema />
        <FAQSchema />
        <PublicDirWrapper>
          <PublicNav />
          <main>{children}</main>
          <PublicFooter />
          <WhatsAppButton />
        </PublicDirWrapper>
      </FeatureFlagsProvider>
    </LangProvider>
  );
}
