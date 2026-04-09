"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Trash2, Pencil } from "lucide-react";
import { togglePackageActive, deletePackage } from "./actions";
import { useLang } from "@/lib/i18n/context";

export function PackageActions({ packageId, isActive }: { packageId: string; isActive: boolean }) {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    await togglePackageActive(packageId, !isActive);
    setLoading(false);
  }

  async function handleDelete() {
    if (!confirm(t("هل أنت متأكد من حذف هذه الباقة؟", "Are you sure you want to delete this package?"))) return;
    setLoading(true);
    await deletePackage(packageId);
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/admin/packages/${packageId}/edit`}
        className="glass-pill p-2 text-muted transition-colors hover:text-gold"
        title={t("تعديل", "Edit")}
      >
        <Pencil size={14} />
      </Link>
      <button
        onClick={handleToggle}
        disabled={loading}
        className="glass-pill p-2 text-muted transition-colors hover:text-gold disabled:opacity-50"
        title={isActive ? t("إخفاء", "Hide") : t("إظهار", "Show")}
      >
        {isActive ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="glass-pill p-2 text-muted transition-colors hover:text-error disabled:opacity-50"
        title={t("حذف", "Delete")}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
