import { Nav } from "@/components/shared/nav";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <Nav role="teacher" />
      {children}
    </div>
  );
}
