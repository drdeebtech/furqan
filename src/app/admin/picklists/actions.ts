"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { requireAdmin } from "@/lib/auth/require-admin";

// teacher_languages / teacher_specialties / teacher_recitations were
// added in v15_008. supabase.generated.ts isn't kept in sync — escape
// hatch consistent with the other content-table queries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type PicklistTable = "teacher_languages" | "teacher_specialties" | "teacher_recitations";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
function intOr(formData: FormData, key: string, def: number): number {
  const v = formData.get(key);
  if (typeof v !== "string") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function revalidatePicklistConsumers() {
  revalidatePath("/admin/picklists");
  revalidatePath("/teacher/cv");
  revalidatePath("/teach/apply");
  revalidatePath("/admin/teachers/new");
  revalidatePath("/teachers-page");
}

const upsertBase = loudAction<{
  table: PicklistTable;
  oldKey: string | null; // present when editing (key is the PK)
  key: string;
  label_ar: string;
  label_en: string;
  sort_order: number;
  is_active: boolean;
}, { message?: string }>({
  name: "admin.picklist.upsert",
  severity: "info",
  audit: {
    table: "teacher_picklist",
    recordId: (i) => `${i.table}:${i.key}`,
    action: "UPDATE",
    reasonPrefix: "admin upsert teacher picklist row",
  },
  handler: async (input) => {
    const supabase = (await createClient()) as AnyClient;
    const row = {
      key: input.key,
      label_ar: input.label_ar,
      label_en: input.label_en,
      sort_order: input.sort_order,
      is_active: input.is_active,
    };

    if (input.oldKey && input.oldKey !== input.key) {
      // Renaming the PK — supabase doesn't allow .update() on the PK
      // column directly without the right type config. Safer two-step:
      // insert new, delete old.
      const { error: insErr } = await supabase.from(input.table).insert(row);
      if (insErr) throw insErr;
      const { error: delErr } = await supabase.from(input.table).delete().eq("key", input.oldKey);
      if (delErr) throw delErr;
    } else if (input.oldKey) {
      const { error } = await supabase.from(input.table).update(row).eq("key", input.oldKey);
      if (error) throw error;
    } else {
      const { error } = await supabase.from(input.table).insert(row);
      if (error) throw error;
    }

    revalidatePicklistConsumers();
    return { message: input.oldKey ? "تم الحفظ" : "تمت الإضافة" };
  },
});

export async function upsertPicklistRow(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  const table = formData.get("table");
  if (table !== "teacher_languages" && table !== "teacher_specialties" && table !== "teacher_recitations") {
    return { ok: false, error: "جدول غير صالح" };
  }
  const key = str(formData, "key");
  const label_ar = str(formData, "label_ar");
  const label_en = str(formData, "label_en");
  if (!key || !label_ar || !label_en) {
    return { ok: false, error: "المفتاح والتسميتان مطلوبة" };
  }
  return upsertBase({
    table,
    oldKey: str(formData, "old_key"),
    key,
    label_ar,
    label_en,
    sort_order: intOr(formData, "sort_order", 100),
    is_active: bool(formData, "is_active"),
  });
}

export async function deletePicklistRow(
  table: PicklistTable,
  key: string,
): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  const supabase = (await createClient()) as AnyClient;
  const { error } = await supabase.from(table).delete().eq("key", key);
  if (error) return { ok: false, error: error.message };
  revalidatePicklistConsumers();
  return { ok: true, message: "تم الحذف" };
}
