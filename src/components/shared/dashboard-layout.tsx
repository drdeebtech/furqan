import { Nav } from "@/components/shared/nav";
import { Topbar } from "@/components/shared/topbar";
import { LangProvider } from "@/lib/i18n/context";
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
  let roles: Role[] = [role];
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, roles")
      .eq("id", user.id)
      .single<{ full_name: string | null; roles: Role[] | null }>();
    userName = data?.full_name ?? undefined;
    if (data?.roles && data.roles.length > 0) roles = data.roles;
  }

  return (
    <LangProvider>
      <div className="dashboard-chrome min-h-screen">
        <Nav role={role} userName={userName} />
        <main id="main-content" className="min-h-screen pt-14 md:pt-0 md:ms-64">
          <div className="hidden md:block md:px-6 md:pt-5 md:pb-4">
            <Topbar role={role} roles={roles} />
          </div>
          <div className="dashboard-content-shell">
            {children}
          </div>
        </main>
      </div>
    </LangProvider>
  );
}
