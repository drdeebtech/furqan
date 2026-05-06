import type { ReactNode } from "react";

/**
 * Page header — title, optional icon, optional subtitle, optional actions slot.
 *
 * Replaces the inline `<div className="mb-6 flex...">` + `<h1>` pattern
 * scattered across ~74 dashboard pages. Two existing variants (with /
 * without icon) are unified through the optional `icon` prop.
 *
 * Match-the-existing-visual: when this primitive lands across all 74
 * call sites, the diff should be visually identical to production.
 *
 * Usage:
 *   <PageHeader title={t("إدارة المدونة", "Manage Blog")} />
 *
 *   <PageHeader
 *     icon={<GraduationCap size={24} className="text-gold" />}
 *     title={t("إدارة المعلمين", "Manage Teachers")}
 *     actions={<Link href="/admin/teachers/new">…</Link>}
 *   />
 */
interface Props {
  /** Optional leading icon — typically a lucide-react `<Icon size={24} className="text-gold" />`. */
  icon?: ReactNode;
  /** Page title. Pass through `t(ar, en)` for bilingual. */
  title: string;
  /** Optional subtitle line under the title. */
  subtitle?: string;
  /** Optional trailing action(s) — buttons, links, badges. Renders to the end of the row. */
  actions?: ReactNode;
}

export function PageHeader({ icon, title, subtitle, actions }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          {icon}
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
