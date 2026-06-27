// Spec 031 — PDF certificate delivery
//
// GET /api/certificates/pdf/[slug]
//
// Normal path (cert issued after 031 deploy):
//   pdf_url is already set by the issuance after() hook → 302 to Bunny CDN URL.
//
// Cold-cache fallback (cert issued before 031, or async generation failed):
//   render → upload to Bunny → persist pdf_url → 302.
//
// Security: slug is zod-validated as UUID. Unknown slug → 404.
//           No session required; unguessable slug = capability auth.
//           Never exposes pdf_url origin or internal cert id in error messages.

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicCertificate } from "@/lib/domains/certificates/view";
import { renderCertificatePdf } from "@/lib/domains/certificates/pdf";
import { putStorageObject, isBunnyStorageConfigured } from "@/lib/bunny/storage";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

const slugSchema = z.string().uuid();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  // Validate slug is a UUID (bad format → 422, not 400, to distinguish from missing)
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) {
    return new Response("Invalid certificate identifier", { status: 422 });
  }

  const cert = await getPublicCertificate(parsed.data);
  if (!cert) {
    return new Response("Certificate not found", { status: 404 });
  }

  // Cached path — normal case after 031 deploy
  if (cert.pdf_url) {
    return Response.redirect(cert.pdf_url, 302);
  }

  // Cold-cache fallback: generate, upload, persist, redirect
  if (!isBunnyStorageConfigured()) {
    return new Response("PDF generation is not available", { status: 503 });
  }

  try {
    const pdfBuffer = await renderCertificatePdf(cert);
    const remotePath = `certificates/${cert.public_slug}.pdf`;
    const publicUrl = await putStorageObject(remotePath, pdfBuffer);

    // Persist so subsequent requests serve the cached redirect
    const admin = createAdminClient();
    await admin
      .from("certificates")
      .update({ pdf_url: publicUrl, pdf_generated_at: new Date().toISOString() })
      .eq("id", cert.id);

    return Response.redirect(publicUrl, 302);
  } catch (err) {
    logError("certificates/pdf route: generation failed", err, {
      tag: "cert_pdf",
      route: "/api/certificates/pdf/[slug]",
    });
    return new Response("PDF generation failed", { status: 500 });
  }
}
