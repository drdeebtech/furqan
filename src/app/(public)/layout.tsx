import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { WhatsAppButton } from "@/components/public/whatsapp-button";

/**
 * Renders the public-facing page layout with navigation, a main content area, footer, and a WhatsApp action button.
 *
 * @param children - Content to display inside the layout's main area.
 * @returns The layout element containing PublicNav, a `<main>` wrapping `children`, PublicFooter, and WhatsAppButton.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PublicNav />
      <main>{children}</main>
      <PublicFooter />
      <WhatsAppButton />
    </>
  );
}
