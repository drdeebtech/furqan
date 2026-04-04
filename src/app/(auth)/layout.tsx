export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center px-4 py-12"
    >
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gold">فُرقان</h1>
          <p className="mt-1 text-sm text-muted">FURQAN Academy</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-card-border bg-card p-8 shadow-xl shadow-black/20">
          {children}
        </div>
      </div>
    </div>
  );
}
