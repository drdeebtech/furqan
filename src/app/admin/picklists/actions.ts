"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type LoudResult } from "@/lib/actions/loud";
import { routeAction } from "@/lib/actions/route-action";

// teacher_languages / teacher_specialties / teacher_recitations were
// added in v15_008. supabase.generated.ts isn't kept in sync — escape
// hatch consistent with the other content-table queries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type PicklistTable = "teacher_languages" | "teacher_specialties" | "teacher_recitations";

const picklistTable = z.enum(["teacher_languages", "teacher_specialties", "teacher_recitations"]);

const upsertPicklistSchema = z.object({
  table: picklistTable,
  oldKey: z.string().min(1).max(100).nullable(),
  key: z.string().min(1, "المفتاح مطلوب").max(100),
  label_ar: z.string().min(1, "التسمية بالعربية مطلوبة").max(200),
  label_en: z.string().min(1, "التسمية بالإنجليزية مطلوبة").max(200),
  sort_order: z.number().int().min(0).max(10_000),
  is_active: z.boolean(),
});

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
  revalidatePath("/teach-with-us/apply");
  revalidatePath("/admin/teachers/new");
  revalidatePath("/teachers");
}

const upsertBase = routeAction<z.infer<typeof upsertPicklistSchema>, { message?: string }>({
  name: "admin.picklist.upsert",
  role: "admin",
  severity: "info",
  schema: upsertPicklistSchema,
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
  // Auth is now the routeAction preflight on upsertBase (role: "admin") —
  // ForbiddenError surfaces as { ok: false, error: "ليس لديك صلاحية" }.
  // Hand the raw values to the schema; loudAction surfaces a friendly
  // Arabic field-level error for any shape violation (invalid table,
  // missing label, etc).
  return upsertBase({
    table: formData.get("table") as PicklistTable,
    oldKey: str(formData, "old_key"),
    key: str(formData, "key") ?? "",
    label_ar: str(formData, "label_ar") ?? "",
    label_en: str(formData, "label_en") ?? "",
    sort_order: intOr(formData, "sort_order", 100),
    is_active: bool(formData, "is_active"),
  });
}

const deletePicklistRowBase = routeAction<{ table: PicklistTable; key: string }, { message: string }>({
  name: "admin.picklist.delete",
  role: "admin",
  severity: "info",
  schema: z.object({ table: picklistTable, key: z.string().min(1).max(100) }),
  audit: {
    table: "teacher_picklist",
    recordId: (i) => `${i.table}:${i.key}`,
    action: "DELETE",
    reasonPrefix: "admin delete teacher picklist row",
  },
  handler: async ({ table, key }) => {
    const supabase = (await createClient()) as AnyClient;
    const { error } = await supabase.from(table).delete().eq("key", key);
    if (error) throw error;
    revalidatePicklistConsumers();
    return { message: "تم الحذف" };
  },
});

export async function deletePicklistRow(
  table: PicklistTable,
  key: string,
): Promise<LoudResult> {
  // Auth is the routeAction preflight on deletePicklistRowBase (role: "admin").
  return deletePicklistRowBase({ table, key });
}
