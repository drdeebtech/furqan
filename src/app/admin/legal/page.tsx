import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { LegalForm } from "./legal-form";
import type { LegalDocument, LegalDocumentVersion } from "@/lib/site-content/legal";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "الوثائق القانونية" };

export default async function AdminLegalPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();

  const [docsRes, versionsRes] = await Promise.all([
    supabase.from("legal_documents")
      .select("kind, body_ar, body_en, version, updated_at")
      .in("kind", ["terms", "privacy"]),
    supabase.from("legal_document_versions")
      .select("id, kind, version, body_ar, body_en, effective_at, superseded_at, saved_by, created_at")
      .in("kind", ["terms", "privacy"])
      .order("version", { ascending: false })
      .limit(20),
  ]);
  const rows = ((docsRes.data ?? []) as LegalDocument[]);
  const terms = rows.find((r) => r.kind === "terms") ?? null;
  const privacy = rows.find((r) => r.kind === "privacy") ?? null;

  const allVersions = (versionsRes.data ?? []) as LegalDocumentVersion[];
  const termsHistory = allVersions.filter((v) => v.kind === "terms");
  const privacyHistory = allVersions.filter((v) => v.kind === "privacy");

  return (
    <main dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Scale size={24} className="text-gold" aria-hidden="true" />}
        title={t("الوثائق القانونية", "Legal Documents")}
      />
      <p className="mb-6 text-sm text-muted">
        {t(
          "اترك الحقل فارغاً للعودة إلى النص الأصلي المُضمَّن في الكود. عند ملء الحقل، يتم تجاوز النص الأصلي وعرض ما تكتبه هنا.",
          "Leave the field empty to fall back to the in-code text. Fill it in to override.",
        )}
      </p>
      <p className="mb-8 rounded-xl border border-[var(--surface-border)] bg-foreground/5 p-3 text-xs text-muted">
        {t(
          "صياغة بسيطة: ## للعنوان، - للقائمة، أسطر فارغة بين الفقرات.",
          "Simple format: ## for headings, - for list items, blank lines between paragraphs.",
        )}
      </p>

      <LegalForm kind="terms" titleAr="شروط الاستخدام" titleEn="Terms of Service" doc={terms} history={termsHistory} />
      <div className="my-8 border-t border-[var(--surface-border)]" />
      <LegalForm kind="privacy" titleAr="سياسة الخصوصية" titleEn="Privacy Policy" doc={privacy} history={privacyHistory} />
    </main>
  );
}
