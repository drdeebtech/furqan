import { Nav } from "@/components/shared/nav";
import { LangProvider } from "@/lib/i18n/context";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LangProvider>
      <div className="min-h-screen">
        <Nav role="student" />
        {children}
      </div>
    </LangProvider>
  );
}
