import { Nav } from "@/components/shared/nav";
import { LangProvider } from "@/lib/i18n/context";
import { ToastProvider } from "@/components/shared/toast";
import { createClient } from "@/lib/supabase/server";

export default async function StudentLayout({
  children,
}: {
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
          <Nav role="student" userName={userName} />
          {children}
        </div>
      </ToastProvider>
    </LangProvider>
  );
}
