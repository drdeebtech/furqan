import { Nav } from "@/components/shared/nav";
import { LangProvider } from "@/lib/i18n/context";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LangProvider>
      <div className="min-h-screen">
        <Nav role="admin" />
        {children}
      </div>
    </LangProvider>
  );
}
