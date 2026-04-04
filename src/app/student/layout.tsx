import { Nav } from "@/components/shared/nav";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <Nav role="student" />
      {children}
    </div>
  );
}
