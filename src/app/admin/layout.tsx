import { Nav } from "@/components/shared/nav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <Nav role="admin" />
      {children}
    </div>
  );
}
