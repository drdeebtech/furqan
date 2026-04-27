import Image from "next/image";

function initialsOf(name: string | null): string {
  if (!name) return "؟";
  const trimmed = name.trim();
  if (!trimmed) return "؟";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0)).join("").toUpperCase();
}

export function Avatar({
  src,
  name,
  size = 40,
  className = "",
}: {
  src: string | null;
  name: string | null;
  size?: number;
  className?: string;
}) {
  const dim = `${size}px`;
  const base =
    "shrink-0 inline-flex items-center justify-center rounded-full overflow-hidden border border-white/10 bg-white/5";

  if (src) {
    return (
      <span className={`${base} ${className}`} style={{ width: dim, height: dim }}>
        <Image
          src={src}
          alt={name ?? ""}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          unoptimized
        />
      </span>
    );
  }

  return (
    <span
      className={`${base} text-gold font-medium ${className}`}
      style={{ width: dim, height: dim, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      aria-label={name ?? undefined}
    >
      {initialsOf(name)}
    </span>
  );
}
