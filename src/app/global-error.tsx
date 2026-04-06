"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0F0F0F",
          color: "#F5F0E8",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          {/* Warning icon */}
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#C8A652"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ margin: "0 auto 1.5rem" }}
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>

          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              marginBottom: "0.75rem",
            }}
          >
            حدث خطأ غير متوقع
          </h1>

          <p
            style={{
              fontSize: "1rem",
              color: "#9C9488",
              marginBottom: "2rem",
              maxWidth: "28rem",
            }}
          >
            نعتذر عن هذا الخطأ. يرجى المحاولة مرة أخرى.
          </p>

          <button
            onClick={() => reset()}
            style={{
              backgroundColor: "#C8A652",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 2rem",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            حاول مرة أخرى
          </button>
        </div>
      </body>
    </html>
  );
}
