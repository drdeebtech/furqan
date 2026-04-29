"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, ListChecks, Pencil } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { WidgetCard } from "@/components/shared/widget-card";
import {
  createModule,
  updateModule,
  deleteModule,
  assignLesson,
  unassignLesson,
} from "@/lib/actions/modules";

interface ModuleRow {
  id: string;
  title_ar: string;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  is_linear: boolean;
  sort_order: number;
}

interface Lesson {
  id: string;
  title_ar: string;
  title_en: string | null;
  order_index: number;
}

interface Assignment {
  module_id: string;
  lesson_id: string;
  sort_order: number;
}

interface Props {
  courseId: string;
  modules: ModuleRow[];
  lessons: Lesson[];
  assignments: Assignment[];
}

export function ModulesEditor({ courseId, modules, lessons, assignments }: Props) {
  const { t, lang } = useLang();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const lessonsByModule: Record<string, Lesson[]> = {};
  const assignedIds = new Set<string>();
  for (const a of assignments) {
    const lesson = lessons.find((l) => l.id === a.lesson_id);
    if (lesson) {
      (lessonsByModule[a.module_id] ||= []).push(lesson);
      assignedIds.add(a.lesson_id);
    }
  }
  const unassignedLessons = lessons.filter((l) => !assignedIds.has(l.id));

  const handleCreate = (formData: FormData) => {
    startTransition(async () => {
      const res = await createModule(courseId, formData);
      if (res.ok) {
        toast.success(t("تم إنشاء الوحدة", "Module created"));
        setCreating(false);
      } else {
        toast.error(res.error ?? t("فشل", "Failed"));
      }
    });
  };

  const handleUpdate = (moduleId: string, formData: FormData) => {
    startTransition(async () => {
      const res = await updateModule(moduleId, formData);
      if (res.ok) {
        toast.success(t("تم الحفظ", "Saved"));
        setEditingId(null);
      } else {
        toast.error(res.error ?? t("فشل", "Failed"));
      }
    });
  };

  const handleDelete = (moduleId: string) => {
    if (!confirm(t("حذف الوحدة؟ لن تُحذف الدروس بل ستفقد ارتباطها بالوحدة.",
                   "Delete module? Lessons stay but lose their module assignment."))) return;
    startTransition(async () => {
      const res = await deleteModule(moduleId);
      if (res.ok) toast.success(t("تم الحذف", "Deleted"));
      else toast.error(res.error ?? t("فشل", "Failed"));
    });
  };

  const handleAssign = (moduleId: string, lessonId: string) => {
    startTransition(async () => {
      const res = await assignLesson(moduleId, lessonId);
      if (res.ok) toast.success(t("تم التعيين", "Assigned"));
      else toast.error(res.error ?? t("فشل", "Failed"));
    });
  };

  const handleUnassign = (lessonId: string) => {
    startTransition(async () => {
      const res = await unassignLesson(lessonId);
      if (res.ok) toast.success(t("تم الإلغاء", "Unassigned"));
      else toast.error(res.error ?? t("فشل", "Failed"));
    });
  };

  return (
    <div className="space-y-6">
      {modules.map((m) => (
        <ModuleCard
          key={m.id}
          module={m}
          assignedLessons={(lessonsByModule[m.id] ?? []).sort((a, b) => a.order_index - b.order_index)}
          unassignedLessons={unassignedLessons}
          editing={editingId === m.id}
          pending={pending}
          onEdit={() => setEditingId(m.id)}
          onCancel={() => setEditingId(null)}
          onSave={(fd) => handleUpdate(m.id, fd)}
          onDelete={() => handleDelete(m.id)}
          onAssign={(lid) => handleAssign(m.id, lid)}
          onUnassign={(lid) => handleUnassign(lid)}
          lang={lang}
          t={t}
        />
      ))}

      {creating ? (
        <WidgetCard title={t("وحدة جديدة", "New Module")}>
          <ModuleForm
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
            pending={pending}
            t={t}
          />
        </WidgetCard>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="glass-pill inline-flex items-center gap-2 border border-[var(--surface-border)] px-4 py-2 text-sm font-medium hover:bg-foreground/5"
        >
          <Plus size={14} aria-hidden="true" />
          {t("إضافة وحدة", "Add Module")}
        </button>
      )}

      {unassignedLessons.length > 0 && modules.length > 0 && (
        <div className="glass-card p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-light">
            {t("دروس بدون وحدة", "Lessons without a module")}
          </p>
          <ul className="text-sm text-muted">
            {unassignedLessons.map((l) => (
              <li key={l.id} className="py-1">
                #{l.order_index} {lang === "ar" ? l.title_ar : (l.title_en ?? l.title_ar)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ModuleCard({
  module: m, assignedLessons, unassignedLessons,
  editing, pending,
  onEdit, onCancel, onSave, onDelete, onAssign, onUnassign,
  lang, t,
}: {
  module: ModuleRow;
  assignedLessons: Lesson[];
  unassignedLessons: Lesson[];
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (fd: FormData) => void;
  onDelete: () => void;
  onAssign: (lessonId: string) => void;
  onUnassign: (lessonId: string) => void;
  lang: "ar" | "en";
  t: (ar: string, en: string) => string;
}) {
  const title = lang === "ar" ? m.title_ar : (m.title_en ?? m.title_ar);

  return (
    <WidgetCard
      title={title}
      headerAction={
        editing ? null : (
          <div className="flex items-center gap-2">
            {m.is_linear && (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                <ListChecks size={10} className="me-1 inline" /> {t("خطّي", "Linear")}
              </span>
            )}
            <button type="button" onClick={onEdit} aria-label={t("تعديل", "Edit")} className="text-muted-light hover:text-foreground">
              <Pencil size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={onDelete} aria-label={t("حذف", "Delete")} className="text-muted-light hover:text-error">
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        )
      }
    >
      {editing ? (
        <ModuleForm
          initial={m}
          onSubmit={onSave}
          onCancel={onCancel}
          pending={pending}
          t={t}
        />
      ) : (
        <>
          {assignedLessons.length === 0 ? (
            <p className="py-3 text-xs text-muted">{t("لا توجد دروس بعد", "No lessons yet")}</p>
          ) : (
            <ol className="space-y-1.5">
              {assignedLessons.map((l, i) => (
                <li key={l.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-foreground/5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-light)] text-[10px] font-semibold">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm">{lang === "ar" ? l.title_ar : (l.title_en ?? l.title_ar)}</span>
                  <button
                    type="button"
                    onClick={() => onUnassign(l.id)}
                    disabled={pending}
                    aria-label={t("إزالة", "Unassign")}
                    className="text-muted-light hover:text-error disabled:opacity-40"
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}

          {unassignedLessons.length > 0 && (
            <div className="mt-3 border-t border-[var(--surface-divider,#F0F0F2)] pt-3">
              <p className="mb-1 text-xs text-muted">{t("إضافة درس", "Add lesson")}:</p>
              <select
                disabled={pending}
                onChange={(e) => {
                  if (e.target.value) {
                    onAssign(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="glass-input h-9 w-full rounded-lg px-2 text-sm"
              >
                <option value="">— {t("اختر درسًا", "Select a lesson")} —</option>
                {unassignedLessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    #{l.order_index} {lang === "ar" ? l.title_ar : (l.title_en ?? l.title_ar)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </WidgetCard>
  );
}

function ModuleForm({
  initial, onSubmit, onCancel, pending, t,
}: {
  initial?: ModuleRow;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
  pending: boolean;
  t: (ar: string, en: string) => string;
}) {
  return (
    <form
      action={onSubmit}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="title_ar"
          required
          defaultValue={initial?.title_ar ?? ""}
          placeholder={t("العنوان بالعربية *", "Title (Arabic) *")}
          className="glass-input h-10 w-full rounded-lg px-3 text-sm"
        />
        <input
          name="title_en"
          defaultValue={initial?.title_en ?? ""}
          placeholder={t("العنوان بالإنجليزية", "Title (English)")}
          className="glass-input h-10 w-full rounded-lg px-3 text-sm"
        />
      </div>
      <textarea
        name="description_ar"
        defaultValue={initial?.description_ar ?? ""}
        placeholder={t("الوصف (اختياري)", "Description (optional)")}
        rows={2}
        className="glass-input w-full rounded-lg px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_linear"
            defaultChecked={initial?.is_linear ?? false}
            className="h-4 w-4 cursor-pointer accent-[var(--gold)]"
          />
          {t("ترتيب خطي (يتطلب إكمال متسلسل)", "Linear order (requires sequential completion)")}
        </label>
        <input
          type="number"
          name="sort_order"
          defaultValue={initial?.sort_order ?? 0}
          className="glass-input h-9 w-20 rounded-lg px-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? t("...", "Saving…") : (initial ? t("حفظ", "Save") : t("إنشاء", "Create"))}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="glass-pill border border-[var(--surface-border)] px-3 py-2 text-sm text-muted hover:text-foreground"
        >
          {t("إلغاء", "Cancel")}
        </button>
      </div>
    </form>
  );
}
