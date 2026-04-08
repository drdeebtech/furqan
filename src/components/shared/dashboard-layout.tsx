import { Nav } from "@/components/shared/nav";
import { LangProvider } from "@/lib/i18n/context";
import { ToastProvider } from "@/components/shared/toast";
import { createClient } from "@/lib/supabase/server";

type Role = "student" | "teacher" | "admin" | "moderator";

export async function DashboardLayout({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let userName: string | undefined;
  if (user) {
    const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).single<{ full_name: string | null }>();
    userName = data?.full_name ?? undefined;
  }

  return (
    <LangProvider>
      <ToastProvider>
        <div className="min-h-screen">
          <Nav role={role} userName={userName} />
          <main id="main-content" className="min-h-screen pt-14 md:pt-0 md:ms-64">
            {children}
          </main>
        </div>
      </ToastProvider>
    </LangProvider>
  );
}
