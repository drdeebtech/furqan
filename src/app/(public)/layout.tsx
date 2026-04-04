import { LangProvider } from "@/lib/i18n/context";
import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { OrganizationSchema, FAQSchema } from "@/components/seo/structured-data";
import { PublicDirWrapper } from "./dir-wrapper";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LangProvider>
      <OrganizationSchema />
      <FAQSchema />
      <PublicDirWrapper>
        <PublicNav />
        <main>{children}</main>
        <PublicFooter />
        <WhatsAppButton />
      </PublicDirWrapper>
    </LangProvider>
  );
}
