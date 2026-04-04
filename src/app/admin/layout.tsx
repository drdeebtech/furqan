import { Nav } from "@/components/shared/nav";
import { LangProvider } from "@/lib/i18n/context";
import { LangToggle } from "@/lib/i18n/lang-toggle";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LangProvider>
      <div className="min-h-screen">
        <Nav role="admin" />
        <div className="flex justify-end px-4 py-2">
          <LangToggle />
        </div>
        {children}
      </div>
    </LangProvider>
  );
}
